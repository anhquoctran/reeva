import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from './postgres_test_helpers.mjs'
import { createStorageConfigEncryptor } from './storage_provider_config_crypto.mjs'

const database = await createTestDatabase('storage_config')
const secret = 'synthetic-migration-secret'
const env = {
  ...database.env,
  S3_ENDPOINT: 'https://s3.invalid.example',
  S3_REGION: 'auto',
  S3_BUCKET: 'reeva-migration-bucket',
  S3_ACCESS_KEY_ID: 'synthetic-migration-access',
  S3_SECRET_ACCESS_KEY: secret,
  S3_SESSION_TOKEN: '',
  S3_FORCE_PATH_STYLE: 'true',
  S3_MAX_ATTEMPTS: '1',
  S3_CONNECTION_TIMEOUT_MS: '10000',
  S3_SOCKET_TIMEOUT_MS: '120000',
  S3_DOWNLOAD_URL_TTL_SECONDS: '300',
}
const encryption = createStorageConfigEncryptor(env.APP_KEY)

function ace(...args) {
  const commandArgs = ['ace', ...args]
  if (args[0]?.startsWith('migration:')) commandArgs.push('--no-schema-generate')
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0)
    throw new Error(`${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
  return `${result.stdout || ''}${result.stderr || ''}`
}

try {
  ace('migration:run', '--force')
  const environmentProviderId = randomUUID()
  const plainProviderId = randomUUID()
  await database.client.query(
    'INSERT INTO storage_providers (id,name,type,config,is_default,is_active) VALUES ($1,$2,$3,$4,false,true)',
    [
      environmentProviderId,
      'Legacy environment provider',
      'cloud',
      { driver: 's3', configSource: 'environment' },
    ]
  )
  await database.client.query(
    'INSERT INTO storage_providers (id,name,type,config,is_default,is_active) VALUES ($1,$2,$3,$4,false,true)',
    [
      plainProviderId,
      'Legacy local provider',
      'local',
      { driver: 'local', root: '/tmp/reeva-legacy' },
    ]
  )

  await database.client.query(
    "DELETE FROM adonis_schema WHERE name LIKE '%1777300000000_encrypt_storage_provider_configs%'"
  )
  ace('migration:run', '--force')

  const migratedEnvironmentProvider = (
    await database.client.query('SELECT config FROM storage_providers WHERE id=$1', [
      environmentProviderId,
    ])
  ).rows[0].config
  assert.equal(migratedEnvironmentProvider.__reevaStorageProviderConfig, 1)
  assert.equal(JSON.stringify(migratedEnvironmentProvider).includes(secret), false)
  assert.deepEqual(encryption.decrypt(migratedEnvironmentProvider), {
    driver: 's3',
    bucket: 'reeva-migration-bucket',
    region: 'auto',
    endpoint: 'https://s3.invalid.example',
    accessKeyId: 'synthetic-migration-access',
    secretAccessKey: secret,
    forcePathStyle: true,
    maxAttempts: 1,
    connectionTimeoutMs: 10_000,
    socketTimeoutMs: 120_000,
    downloadUrlTtlSeconds: 300,
  })
  const migratedPlainProvider = (
    await database.client.query('SELECT config FROM storage_providers WHERE id=$1', [
      plainProviderId,
    ])
  ).rows[0].config
  assert.deepEqual(encryption.decrypt(migratedPlainProvider), {
    driver: 'local',
    root: '/tmp/reeva-legacy',
  })

  const migrationBatch = (
    await database.client.query(
      "SELECT batch FROM adonis_schema WHERE name LIKE '%1777300000000_encrypt_storage_provider_configs%'"
    )
  ).rows[0].batch
  process.stdout.write(`Rolling back storage config migration batch ${migrationBatch}.\n`)
  const rollbackOutput = ace('migration:rollback', `--batch=${migrationBatch - 1}`)
  process.stdout.write(`${rollbackOutput || '(no migration output)'}\n`)
  const rolledBackEnvironmentProvider = (
    await database.client.query('SELECT config FROM storage_providers WHERE id=$1', [
      environmentProviderId,
    ])
  ).rows[0].config
  assert.equal(rolledBackEnvironmentProvider.__reevaStorageProviderConfig, undefined)
  assert.deepEqual(rolledBackEnvironmentProvider, encryption.decrypt(migratedEnvironmentProvider))
  const rolledBackPlainProvider = (
    await database.client.query('SELECT config FROM storage_providers WHERE id=$1', [
      plainProviderId,
    ])
  ).rows[0].config
  assert.deepEqual(rolledBackPlainProvider, { driver: 'local', root: '/tmp/reeva-legacy' })

  ace('migration:run', '--force')
  const reencryptedEnvironmentProvider = (
    await database.client.query('SELECT config FROM storage_providers WHERE id=$1', [
      environmentProviderId,
    ])
  ).rows[0].config
  assert.equal(reencryptedEnvironmentProvider.__reevaStorageProviderConfig, 1)

  ace('db:seed')
  const seededProviders = await database.client.query(
    'SELECT name,type,is_default,is_active FROM storage_providers ORDER BY name'
  )
  assert.equal(
    seededProviders.rows.filter((provider) => provider.is_default).length,
    1,
    `Expected one seeded default provider, got ${JSON.stringify(seededProviders.rows)}`
  )
  const legacyProvider = (
    await database.client.query('SELECT config,is_default FROM storage_providers WHERE id=$1', [
      environmentProviderId,
    ])
  ).rows[0]
  assert.equal(legacyProvider.is_default, false)
  assert.equal(JSON.stringify(legacyProvider.config).includes('configSource'), false)

  process.stdout.write(
    'Storage config migration passed: legacy environment and plaintext JSON configs migrated to ciphertext; rollback restored the previous plain format and re-upgrade re-encrypted it; seeding kept the local default.\n'
  )
} finally {
  await database.close()
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from './postgres_test_helpers.mjs'
import { importLegacyData } from './legacy_data_import.mjs'
import { createStorageConfigEncryptor } from './storage_provider_config_crypto.mjs'

const database = await createTestDatabase('import')
const storageConfigEncryptor = createStorageConfigEncryptor(database.env.APP_KEY)
try {
  const migration = spawnSync(process.execPath, ['ace', 'migration:run', '--no-schema-generate'], {
    env: database.env,
    encoding: 'utf8',
    timeout: 30000,
  })
  if (migration.status !== 0) throw new Error(migration.stdout + migration.stderr)
  const ids = Object.fromEntries(
    [
      'user',
      'platform',
      'architecture',
      'provider',
      'version',
      'artifact',
      'product',
      'otherProduct',
      'otherVersion',
    ].map((name) => [name, randomUUID()])
  )
  const document = {
    formatVersion: 1,
    tables: {
      users: [
        {
          id: ids.user,
          email: 'import@example.invalid',
          password_hash: 'synthetic-password-hash',
          auth_version: 4,
        },
      ],
      settings: [{ id: randomUUID(), key: 'appName', value: 'Legacy Desktop' }],
      platforms: [{ id: ids.platform, name: 'linux', display_name: 'Linux' }],
      architectures: [{ id: ids.architecture, name: 'x64', display_name: 'x64' }],
      storage_providers: [
        {
          id: ids.provider,
          name: 'Imported local',
          type: 'local',
          config: JSON.stringify({ driver: 'local', root: '/preserved/artifacts' }),
          is_default: 1,
          is_active: 1,
          quota_bytes: '10737418240',
        },
      ],
      versions: [{ id: ids.version, major: 1, minor: 2, patch: 3, is_active: 1 }],
      artifacts: [
        {
          id: ids.artifact,
          version_id: ids.version,
          platform_id: ids.platform,
          architecture_id: ids.architecture,
          storage_provider_id: ids.provider,
          file_name: 'original.zip',
          storage_key: 'original/path.zip',
          size_bytes: '900000000',
          checksum_sha256: 'a'.repeat(64),
          channel: 'stable',
          is_published: 1,
          is_archived: 0,
        },
      ],
      remember_me_tokens: [{ hash: 'synthetic-private-token' }],
      password_reset_tokens: [{ token: 'synthetic-private-token' }],
    },
  }
  const baseline = (await database.client.query('SELECT id FROM software')).rows[0].id
  const dryRun = await importLegacyData(database.client, document, {
    dryRun: true,
    encryptStorageConfig: storageConfigEncryptor.encrypt,
  })
  assert.equal(dryRun.counts.artifacts, 1)
  assert.equal((await database.client.query('SELECT id FROM software')).rows[0].id, baseline)
  assert.equal((await database.client.query('SELECT count(*) FROM users')).rows[0].count, '0')
  const invalid = structuredClone(document)
  invalid.tables.artifacts[0].architecture_id = randomUUID()
  await assert.rejects(
    importLegacyData(database.client, invalid, {
      encryptStorageConfig: storageConfigEncryptor.encrypt,
    }),
    { code: '23503' }
  )
  assert.equal((await database.client.query('SELECT count(*) FROM users')).rows[0].count, '0')
  assert.equal((await database.client.query('SELECT id FROM software')).rows[0].id, baseline)
  const multiSoftware = structuredClone(document)
  multiSoftware.tables.software = [
    { id: ids.product, name: 'First', slug: 'first', is_active: 1, is_default: 1 },
    { id: ids.otherProduct, name: 'Second', slug: 'second', is_active: 1, is_default: 0 },
  ]
  multiSoftware.tables.versions[0].software_id = ids.product
  multiSoftware.tables.versions.push({
    id: ids.otherVersion,
    software_id: ids.otherProduct,
    major: 1,
    minor: 2,
    patch: 3,
    is_active: 1,
  })
  await importLegacyData(database.client, multiSoftware, {
    encryptStorageConfig: storageConfigEncryptor.encrypt,
  })
  const importedProvider = (await database.client.query('SELECT config FROM storage_providers'))
    .rows[0]
  assert.notEqual(importedProvider.config.__reevaStorageProviderConfig, undefined)
  assert.deepEqual(storageConfigEncryptor.decrypt(importedProvider.config), {
    driver: 'local',
    root: '/preserved/artifacts',
  })
  const artifact = (await database.client.query('SELECT * FROM artifacts')).rows[0]
  assert.equal(artifact.id, ids.artifact)
  assert.equal(artifact.storage_key, 'original/path.zip')
  assert.equal(artifact.checksum_sha256, 'a'.repeat(64))
  assert.equal(artifact.size_bytes, '900000000')
  assert.equal(artifact.is_published, true)
  assert.equal(
    (await database.client.query('SELECT auth_version,password_hash FROM users')).rows[0]
      .auth_version,
    5
  )
  assert.equal(
    (await database.client.query('SELECT password_hash FROM users')).rows[0].password_hash,
    'synthetic-password-hash'
  )
  assert.equal(
    (await database.client.query('SELECT count(*) FROM remember_me_tokens')).rows[0].count,
    '0'
  )
  assert.equal((await database.client.query('SELECT count(*) FROM versions')).rows[0].count, '2')
  await assert.rejects(
    importLegacyData(database.client, multiSoftware, {
      encryptStorageConfig: storageConfigEncryptor.encrypt,
    }),
    /not empty/
  )
  assert.equal((await database.client.query('SELECT count(*) FROM versions')).rows[0].count, '2')
  console.log(
    'Legacy import passed: dry-run rollback, FK failure rollback, nonempty-target refusal, UUID/JSONB/boolean/bigint conversion, multi-software IDs/checksums/keys preserved, sessions and tokens invalidated.'
  )
} finally {
  await database.close()
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = await mkdtemp(join(tmpdir(), 'reeva-s3-env-seed-'))
const databasePath = join(scratch, 'reeva.sqlite3')
const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '8888',
  LOG_LEVEL: 'error',
  APP_KEY: 'synthetic-s3-seed-check-key-0123456789012345678901',
  APP_URL: 'http://127.0.0.1:8888',
  SESSION_DRIVER: 'cookie',
  DB_CONNECTION: 'sqlite',
  SQLITE_DATABASE_PATH: databasePath,
  MAIL_MAILER: 'smtp',
  MAIL_FROM_NAME: 'S3 seed verification',
  MAIL_FROM_ADDRESS: 'verify@example.invalid',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://s3.invalid.example',
  S3_REGION: 'auto',
  S3_BUCKET: 'reeva-verification-bucket',
  S3_ACCESS_KEY_ID: 'synthetic-s3-access-key',
  S3_SECRET_ACCESS_KEY: 'synthetic-s3-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  S3_MAX_ATTEMPTS: '1',
  S3_CONNECTION_TIMEOUT_MS: '10000',
  S3_SOCKET_TIMEOUT_MS: '120000',
  S3_DOWNLOAD_URL_TTL_SECONDS: '300',
}

function ace(...args) {
  const result = spawnSync(process.execPath, ['ace', ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
}

try {
  ace('migration:run', '--force')
  ace('db:seed')

  const database = new Database(databasePath)
  const readProviders = () =>
    database
      .prepare('SELECT id, config, is_default, is_active FROM storage_providers')
      .all()
      .map((provider) => ({ ...provider, config: JSON.parse(provider.config) }))

  const firstRun = readProviders()
  const configuredProvider = firstRun.find(
    (provider) =>
      provider.is_default === 1 &&
      provider.config.driver === 's3' &&
      provider.config.configSource === 'environment'
  )
  assert.ok(configuredProvider, 'S3 env provider should become the default')
  assert.equal(configuredProvider.is_active, 1)
  assert.deepEqual(configuredProvider.config, { driver: 's3', configSource: 'environment' })
  assert.equal(firstRun.filter((provider) => provider.is_default === 1).length, 1)

  ace('db:seed')
  const secondRun = readProviders()
  assert.equal(secondRun.length, firstRun.length, 'rerunning seeds must not add provider rows')
  assert.equal(
    secondRun.find((provider) => provider.is_default === 1)?.id,
    configuredProvider.id,
    'rerunning seeds should preserve and reselect the environment provider'
  )
  assert.equal(JSON.stringify(secondRun).includes(env.S3_SECRET_ACCESS_KEY), false)
  database.close()

  process.stdout.write(
    'S3 environment provider seed passed: selected as the sole default, repeat-safe, and DB config contains no S3 secret\n'
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Run this migration check with Node >=24.')
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const database = `reeva_migration_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const host = process.env.REEVA_TEST_MYSQL_HOST || '127.0.0.1'
const port = Number(process.env.REEVA_TEST_MYSQL_PORT || 3306)
const user = process.env.REEVA_TEST_MYSQL_USER || 'root'
const password = process.env.REEVA_TEST_MYSQL_PASSWORD
const migrationName = '1777000000000_create_auth_rate_limits_and_upload_reservations'
const softwareMigrationName = '1777100000000_add_software_products'
const oldUserId = 'd480dbee-6c75-44f8-9af4-750ed1565718'

if (!password) throw new Error('Set REEVA_TEST_MYSQL_PASSWORD for the disposable MySQL check.')

const admin = await mysql.createConnection({ host, port, user, password })
let connection
let databaseCreated = false

function runAce(command, args) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: '3333',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'error',
    APP_KEY: 'temporary-mysql-migration-check-key-012345678901234567890123456789',
    APP_URL: 'http://localhost:3333',
    SESSION_DRIVER: 'cookie',
    DB_CONNECTION: 'mysql',
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: user,
    DB_PASSWORD: password,
    DB_DATABASE: database,
    MAIL_MAILER: 'smtp',
    MAIL_FROM_NAME: 'Reeva verification',
    MAIL_FROM_ADDRESS: 'verify@example.invalid',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
  }
  const result = spawnSync(process.execPath, ['ace', command, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout
}

try {
  await admin.query(`CREATE DATABASE ?? CHARACTER SET utf8mb4`, [database])
  databaseCreated = true
  connection = await mysql.createConnection({ host, port, user, password, database })

  runAce('migration:run', ['--no-schema-generate'])
  const [[migration]] = await connection.query(
    'SELECT name, batch FROM adonis_schema WHERE name LIKE ?',
    [`%${migrationName}%`]
  )
  if (!migration) throw new Error('Fresh MySQL migration did not record the new migration.')

  const [[batchRow]] = await connection.query('SELECT MAX(batch) AS batch FROM adonis_schema')
  const isolatedBatch = Number(batchRow.batch || 0) + 1
  await connection.query('UPDATE adonis_schema SET batch = ? WHERE name = ?', [
    isolatedBatch,
    migration.name,
  ])
  await connection.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    oldUserId,
    'legacy@example.invalid',
    'synthetic-hash',
  ])

  runAce('migration:rollback', [`--batch=${isolatedBatch - 1}`, '--no-schema-generate'])
  const [[userColumn]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = 'users' AND column_name = 'auth_version'",
    [database]
  )
  const [[supportTables]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('auth_rate_limits', 'storage_upload_reservations')",
    [database]
  )
  const [[releaseIndex]] = await connection.query(
    "SELECT COUNT(DISTINCT index_name) AS count FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'artifacts' AND index_name = 'idx_artifacts_public_release'",
    [database]
  )
  if (
    Number(userColumn.count) !== 0 ||
    Number(supportTables.count) !== 0 ||
    Number(releaseIndex.count) !== 0
  ) {
    throw new Error('MySQL down migration left an additive schema object behind.')
  }

  await connection.query(
    'INSERT INTO remember_me_tokens (tokenable_id, hash, created_at, updated_at, expires_at) VALUES (?, ?, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [oldUserId, 'synthetic-remember-hash']
  )
  runAce('migration:run', ['--no-schema-generate'])

  const [[legacyUser]] = await connection.query(
    'SELECT id, email, auth_version FROM users WHERE id = ?',
    [oldUserId]
  )
  const [[rememberTokens]] = await connection.query(
    'SELECT COUNT(*) AS count FROM remember_me_tokens WHERE tokenable_id = ?',
    [oldUserId]
  )
  const [[upgradedTables]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('auth_rate_limits', 'storage_upload_reservations')",
    [database]
  )
  const [[upgradedIndex]] = await connection.query(
    "SELECT COUNT(DISTINCT index_name) AS count FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'artifacts' AND index_name = 'idx_artifacts_public_release'",
    [database]
  )
  const [[reservationForeignKey]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = 'storage_upload_reservations' AND column_name = 'storage_provider_id' AND referenced_table_name = 'storage_providers'",
    [database]
  )

  if (!legacyUser || Number(legacyUser.auth_version) !== 0) {
    throw new Error('MySQL upgrade did not preserve the legacy user with auth_version=0.')
  }
  if (Number(rememberTokens.count) !== 0) {
    throw new Error('MySQL upgrade did not revoke the legacy remember-me token.')
  }
  if (Number(upgradedTables.count) !== 2 || Number(upgradedIndex.count) !== 1) {
    throw new Error('MySQL upgrade did not create the expected support tables and release index.')
  }
  if (Number(reservationForeignKey.count) !== 1) {
    throw new Error('MySQL upload reservation foreign key was not created.')
  }

  const [[softwareMigration]] = await connection.query(
    'SELECT name FROM adonis_schema WHERE name LIKE ?',
    [`%${softwareMigrationName}%`]
  )
  if (!softwareMigration) throw new Error('MySQL software migration was not recorded.')
  const [[softwareBatch]] = await connection.query('SELECT MAX(batch) AS batch FROM adonis_schema')
  const softwareIsolatedBatch = Number(softwareBatch.batch || 0) + 1
  await connection.query('UPDATE adonis_schema SET batch = ? WHERE name = ?', [
    softwareIsolatedBatch,
    softwareMigration.name,
  ])
  runAce('migration:rollback', [`--batch=${softwareIsolatedBatch - 1}`, '--no-schema-generate'])

  const legacyVersionId = randomUUID()
  const legacySoftwareName = 'Legacy Desktop'
  await connection.query(
    'INSERT INTO settings (id, `key`, value, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [randomUUID(), 'appName', legacySoftwareName]
  )
  await connection.query(
    'INSERT INTO versions (id, major, minor, patch, codename, changelog, is_active, release_date, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NOW())',
    [legacyVersionId, 7, 8, 9, 'Existing release', 1]
  )
  runAce('migration:run', ['--no-schema-generate'])

  const [[defaultSoftware]] = await connection.query(
    'SELECT id, name, slug, is_default FROM software WHERE slug = ?',
    ['reeva']
  )
  const [[legacyVersion]] = await connection.query(
    'SELECT software_id, major, minor, patch FROM versions WHERE id = ?',
    [legacyVersionId]
  )
  const [[softwareIdNullability]] = await connection.query(
    "SELECT is_nullable, column_type FROM information_schema.columns WHERE table_schema = ? AND table_name = 'versions' AND column_name = 'software_id'",
    [database]
  )
  if (!defaultSoftware || defaultSoftware.name !== legacySoftwareName || Number(defaultSoftware.is_default) !== 1) {
    throw new Error('MySQL migration did not create the legacy default software.')
  }
  if (!legacyVersion || legacyVersion.software_id !== defaultSoftware.id) {
    throw new Error('MySQL migration did not backfill the legacy version.')
  }
  const isSoftwareIdNullable =
    softwareIdNullability?.is_nullable ?? softwareIdNullability?.IS_NULLABLE
  if (!softwareIdNullability || isSoftwareIdNullable !== 'NO') {
    throw new Error(
      `MySQL migration did not make versions.software_id required: ${JSON.stringify(softwareIdNullability)}`
    )
  }

  process.stdout.write(
    JSON.stringify(
      {
        freshMigrations: 'pass',
        migrationDownAndReapply: 'pass',
        upgrade: 'pass',
        mysql: 'MySQL 8 compatible server',
        preservedUser: legacyUser.email,
        authVersion: Number(legacyUser.auth_version),
        rememberMeTokensRevoked: true,
        addedTables: ['auth_rate_limits', 'storage_upload_reservations'],
        publicReleaseIndex: true,
        reservationForeignKey: true,
        softwareMigrationDownAndReapply: 'pass',
        legacyVersionPreserved: '7.8.9',
        defaultSoftware: { name: legacySoftwareName, slug: defaultSoftware.slug },
        softwareIdRequired: true,
        database: 'randomly named disposable schema, dropped after completion',
      },
      null,
      2
    )
  )
} finally {
  try {
    if (connection) await connection.end()
  } finally {
    try {
      if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS ??`, [database])
    } finally {
      await admin.end()
    }
  }
}

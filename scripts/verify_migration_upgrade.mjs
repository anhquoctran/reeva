import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Run this migration check with Node >=24.')
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = await mkdtemp(join(tmpdir(), 'reeva-migration-upgrade-'))
const filename = join(scratch, 'upgrade.sqlite3')
const migrationName = '1777000000000_create_auth_rate_limits_and_upload_reservations'
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '8888',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'error',
  APP_KEY: 'temporary-migration-check-key-012345678901234567890123456789',
  APP_URL: 'http://localhost:8888',
  SESSION_DRIVER: 'cookie',
  DB_CONNECTION: 'sqlite',
  SQLITE_DATABASE_PATH: filename,
  MAIL_MAILER: 'smtp',
  MAIL_FROM_NAME: 'Reeva verification',
  MAIL_FROM_ADDRESS: 'verify@example.invalid',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
}

function runAce(command, args) {
  const result = spawnSync(process.execPath, ['ace', command, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout
}

function migrate() {
  runAce('migration:run', ['--no-schema-generate'])
}

try {
  migrate()
  const initial = new Database(filename)
  initial.pragma('foreign_keys = ON')
  const trackedMigration = initial
    .prepare('SELECT name FROM adonis_schema WHERE name LIKE ?')
    .get(`%${migrationName}%`)
  if (!trackedMigration) throw new Error('New migration was not recorded after fresh migration.')
  initial.prepare('UPDATE adonis_schema SET batch = 2 WHERE name = ?').run(trackedMigration.name)
  initial.close()

  // Isolate the additive migration in its own synthetic batch, then verify its
  // down migration removes only the newly added objects and remains reversible.
  runAce('migration:rollback', ['--batch=1', '--no-schema-generate'])
  const rolledBack = new Database(filename)
  const userColumns = rolledBack.pragma('table_info(users)')
  const addedTablesAfterRollback = rolledBack
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_rate_limits', 'storage_upload_reservations')")
    .all()
  const releaseIndexAfterRollback = rolledBack
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_artifacts_public_release'")
    .get()
  if (userColumns.some((column) => column.name === 'auth_version')) {
    throw new Error('Rollback did not remove the added auth_version column.')
  }
  if (addedTablesAfterRollback.length || releaseIndexAfterRollback) {
    throw new Error('Rollback did not remove all objects added by the migration.')
  }
  rolledBack.close()
  migrate()

  const database = new Database(filename)
  database.pragma('foreign_keys = ON')
  const oldUserId = 'd480dbee-6c75-44f8-9af4-750ed1565718'
  const now = '2026-10-02 00:00:00'

  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
    oldUserId,
    'legacy@example.invalid',
    'synthetic-hash'
  )
  database
    .prepare(
      'INSERT INTO remember_me_tokens (tokenable_id, hash, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(oldUserId, 'synthetic-remember-hash', now, now, '2030-01-01 00:00:00')

  // Recreate the immediately preceding schema on this temporary database,
  // keeping a legacy user and remember-me token as the upgrade fixture.
  database.exec(`
    DROP TABLE auth_rate_limits;
    DROP TABLE storage_upload_reservations;
    DROP INDEX idx_artifacts_public_release;
    ALTER TABLE users DROP COLUMN auth_version;
  `)
  const resetMigration = database
    .prepare('DELETE FROM adonis_schema WHERE name LIKE ?')
    .run(`%${migrationName}%`)
  if (resetMigration.changes !== 1) {
    throw new Error(`Expected to locate one tracked migration, found ${resetMigration.changes}.`)
  }
  database.close()

  migrate()

  const upgraded = new Database(filename)
  const legacyUser = upgraded
    .prepare('SELECT id, email, auth_version FROM users WHERE id = ?')
    .get(oldUserId)
  const remainingTokens = upgraded
    .prepare('SELECT count(*) AS count FROM remember_me_tokens WHERE tokenable_id = ?')
    .get(oldUserId).count
  const tables = upgraded
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_rate_limits', 'storage_upload_reservations')")
    .all()
    .map((row) => row.name)
    .sort()
  upgraded.close()

  if (!legacyUser || legacyUser.auth_version !== 0) {
    throw new Error('Upgrade did not preserve the legacy user and initialize auth_version.')
  }
  if (remainingTokens !== 0) throw new Error('Upgrade did not revoke legacy remember-me tokens.')
  if (tables.join(',') !== 'auth_rate_limits,storage_upload_reservations') {
    throw new Error('Upgrade did not create the additive support tables.')
  }

  process.stdout.write(
    JSON.stringify(
      {
        freshMigrations: 'pass',
        migrationDownAndReapply: 'pass',
        upgrade: 'pass',
        preservedUser: legacyUser.email,
        authVersion: legacyUser.auth_version,
        rememberMeTokensRevoked: true,
        addedTables: tables,
        database: 'temporary SQLite file, removed after completion',
      },
      null,
      2
    )
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

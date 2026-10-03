import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Run this migration check with Node >=24.')
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = await mkdtemp(join(tmpdir(), 'reeva-software-migration-'))
const filename = join(scratch, 'software.sqlite3')
const migrationName = '1777100000000_add_software_products'
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '8888',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'error',
  APP_KEY: 'temporary-software-migration-check-key-01234567890123456789',
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

try {
  runAce('migration:run', ['--no-schema-generate'])
  const database = new Database(filename)
  database.pragma('foreign_keys = ON')

  const migration = database
    .prepare('SELECT name, batch FROM adonis_schema WHERE name LIKE ?')
    .get(`%${migrationName}%`)
  if (!migration) throw new Error('Software migration was not recorded.')
  const maxBatch = database.prepare('SELECT MAX(batch) AS batch FROM adonis_schema').get().batch
  const isolatedBatch = Number(maxBatch) + 1
  database.prepare('UPDATE adonis_schema SET batch = ? WHERE name = ?').run(isolatedBatch, migration.name)
  database.close()

  runAce('migration:rollback', [`--batch=${isolatedBatch - 1}`, '--no-schema-generate'])
  const legacy = new Database(filename)
  if (legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='software'").get()) {
    throw new Error('Software down migration did not remove the new table.')
  }
  if (legacy.pragma('table_info(versions)').some((column) => column.name === 'software_id')) {
    throw new Error('Software down migration did not restore the prior versions shape.')
  }

  const now = '2026-10-03 00:00:00'
  const legacyAppName = 'Legacy Desktop'
  legacy
    .prepare('INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), 'appName', legacyAppName, now, now)
  const legacyVersionId = randomUUID()
  legacy
    .prepare(
      'INSERT INTO versions (id, major, minor, patch, codename, changelog, is_active, release_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(legacyVersionId, 7, 8, 9, null, 'Existing release', 1, null, now)
  legacy.close()

  runAce('migration:run', ['--no-schema-generate'])
  const upgraded = new Database(filename)
  upgraded.pragma('foreign_keys = ON')
  const software = upgraded.prepare('SELECT id, name, slug, is_default FROM software').get()
  const version = upgraded
    .prepare('SELECT software_id, major, minor, patch FROM versions WHERE id = ?')
    .get(legacyVersionId)
  const versionColumns = upgraded.pragma('table_info(versions)')
  const foreignKeyErrors = upgraded.pragma('foreign_key_check')
  if (!software || software.name !== legacyAppName || software.slug !== 'reeva' || !software.is_default) {
    throw new Error('Upgrade did not create the expected default software from the legacy appName.')
  }
  if (!version || version.software_id !== software.id || `${version.major}.${version.minor}.${version.patch}` !== '7.8.9') {
    throw new Error('Upgrade did not preserve and backfill the legacy version.')
  }
  if (versionColumns.find((column) => column.name === 'software_id')?.notnull !== 1) {
    throw new Error('Upgrade did not make versions.software_id required.')
  }
  if (foreignKeyErrors.length) throw new Error('Software upgrade left foreign-key violations.')
  upgraded.close()

  process.stdout.write(
    JSON.stringify(
      {
        sqlite: 'pass',
        softwareMigrationDownAndReapply: 'pass',
        legacyVersionPreserved: '7.8.9',
        defaultSoftware: { name: legacyAppName, slug: 'reeva' },
        softwareIdRequired: true,
        foreignKeyCheck: 'pass',
        database: 'temporary SQLite file, removed after completion',
      },
      null,
      2
    )
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

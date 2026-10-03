import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { importLegacyData } from './legacy_data_import.mjs'

const args = process.argv.slice(2)
const file = args[args.indexOf('--file') + 1]
if (!args.includes('--file') || !file || !args.includes('--empty-target')) {
  throw new Error(
    'Usage: pnpm db:import --file /secure/export.json --empty-target [--dry-run]. Configure PostgreSQL DB_* environment variables explicitly.'
  )
}
if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_DATABASE ||
  (process.env.DB_CONNECTION && process.env.DB_CONNECTION !== 'pg')
) {
  throw new Error(
    'Set PostgreSQL DB_HOST, DB_USER, DB_DATABASE and optional DB_CONNECTION=pg explicitly. No .env file is loaded by this importer.'
  )
}
if (process.env.DB_SSL && !['true', 'false'].includes(process.env.DB_SSL))
  throw new Error('DB_SSL must be true or false.')
const password =
  process.env.DB_PASSWORD ||
  (process.env.DB_PASSWORD_FILE
    ? (await readFile(process.env.DB_PASSWORD_FILE, 'utf8')).trim()
    : undefined)
const ssl =
  process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA_PATH
          ? { ca: await readFile(process.env.DB_SSL_CA_PATH, 'utf8') }
          : {}),
      }
    : false
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password,
  database: process.env.DB_DATABASE,
  ssl,
  options: '-c timezone=UTC',
  connectionTimeoutMillis: 10000,
})
try {
  const document = JSON.parse(await readFile(file, 'utf8'))
  await client.connect()
  const result = await importLegacyData(client, document, { dryRun: args.includes('--dry-run') })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  // PostgreSQL error details can contain exported secrets; output only codes/constraints.
  console.error(
    error.code
      ? `Import failed (${error.code}, constraint=${error.constraint || 'none'}); transaction rolled back.`
      : error instanceof SyntaxError
        ? 'Invalid JSON input; no data was imported.'
        : error.message
  )
  process.exitCode = 1
} finally {
  await client.end()
}

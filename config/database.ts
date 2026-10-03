import { defineConfig } from '@adonisjs/lucid'
import env from '#start/env'
import { readFile } from 'node:fs/promises'
import type { ClientConfig } from 'pg'

const passwordFile = env.get('DB_PASSWORD_FILE')
const configuredPassword = env.get('DB_PASSWORD')
const passwordContents =
  !configuredPassword && passwordFile ? await readFile(passwordFile, 'utf8') : undefined
const password = configuredPassword || passwordContents?.trim()
const caPath = env.get('DB_SSL_CA_PATH')

const connection = {
  host: env.get('DB_HOST') || '127.0.0.1',
  port: env.get('DB_PORT') || 5432,
  user: env.get('DB_USER') || 'reeva',
  password,
  database: env.get('DB_DATABASE') || 'reeva',
  ssl: env.get('DB_SSL')
    ? { rejectUnauthorized: true, ...(caPath ? { ca: await readFile(caPath, 'utf8') } : {}) }
    : false,
  application_name: 'reeva',
  options: '-c timezone=UTC',
} satisfies ClientConfig

export default defineConfig({
  connection: 'pg',
  prettyPrintDebugQueries: true,
  connections: {
    pg: {
      client: 'pg',
      connection,
      pool: { min: 0, max: 10 },
      migrations: { naturalSort: true, paths: ['database/migrations'] },
      debug: false,
    },
  },
})

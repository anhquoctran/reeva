import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0)
    throw new Error(
      result.stderr ||
        'Docker is required, or set REEVA_TEST_PG_* for a test-only PostgreSQL server.'
    )
  return result.stdout.trim()
}

/** Never reads application DB credentials or an existing .env. */
export async function createTestDatabase(label = 'check') {
  const suffix = randomBytes(8).toString('hex')
  const database = `reeva_test_${label.replace(/[^a-z0-9]/g, '_')}_${suffix}`
  let container
  let admin
  let client
  let created = false
  const external = Boolean(process.env.REEVA_TEST_PG_PASSWORD)
  const password = process.env.REEVA_TEST_PG_PASSWORD || randomBytes(32).toString('hex')
  const host = external ? process.env.REEVA_TEST_PG_HOST || '127.0.0.1' : '127.0.0.1'
  const user = external ? process.env.REEVA_TEST_PG_USER || 'postgres' : 'postgres'
  let port = Number(process.env.REEVA_TEST_PG_PORT || 5432)

  async function close() {
    try {
      await client?.end()
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`)
    } finally {
      await admin?.end()
      if (container) docker('rm', '-f', '-v', container)
    }
  }

  try {
    if (!external) {
      container = `reeva-pg-test-${suffix}`
      docker(
        'run',
        '-d',
        '--name',
        container,
        '-p',
        '127.0.0.1::5432',
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        'postgres:17-alpine'
      )
      port = Number(docker('port', container, '5432/tcp').split(':').at(-1))
    }

    const options = {
      host,
      port,
      user,
      password,
      database: process.env.REEVA_TEST_PG_DATABASE || 'postgres',
      connectionTimeoutMillis: 3000,
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      admin = new pg.Client(options)
      try {
        await admin.connect()
        break
      } catch (error) {
        await admin.end().catch(() => {})
        admin = undefined
        if (attempt === 39)
          throw new Error(`Test PostgreSQL not ready (${error.code || 'connection failed'}).`)
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    await admin.query(`CREATE DATABASE "${database}"`)
    created = true
    client = new pg.Client({ ...options, database, options: '-c timezone=UTC' })
    await client.connect()
    return {
      database,
      client,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '8888',
        LOG_LEVEL: 'error',
        APP_KEY: randomBytes(32).toString('hex'),
        APP_URL: 'http://127.0.0.1:8888',
        SESSION_DRIVER: 'cookie',
        DB_CONNECTION: 'pg',
        DB_HOST: host,
        DB_PORT: String(port),
        DB_USER: user,
        DB_PASSWORD: password,
        DB_PASSWORD_FILE: '',
        DB_DATABASE: database,
        DB_SSL: 'false',
        DB_SSL_CA_PATH: '',
        REEVA_TEST_DATABASE: database,
        MAIL_MAILER: 'smtp',
        MAIL_FROM_NAME: 'Reeva verification',
        MAIL_FROM_ADDRESS: 'test@example.invalid',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        ADMIN_EMAIL: '',
        ADMIN_PASSWORD: '',
        STORAGE_DRIVER: 'database',
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

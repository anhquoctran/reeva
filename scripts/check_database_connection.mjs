import { setTimeout } from 'node:timers/promises'
import pg from 'pg'
import { readFile } from 'node:fs/promises'

// Report transport/authentication codes only. Driver messages may contain SQL,
// usernames or credentials and must not be included in startup diagnostics.
function errorCodes(error) {
  const codes = new Set()
  const pending = [error]
  const seen = new Set()
  while (pending.length) {
    const current = pending.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    if (typeof current.code === 'string' && /^[A-Z0-9_]+$/.test(current.code)) {
      codes.add(current.code)
    }
    if (
      current.message === 'timeout expired' ||
      current.message === 'Connection terminated due to connection timeout'
    ) {
      codes.add('ETIMEDOUT')
    }
    if (Array.isArray(current.errors)) pending.push(...current.errors)
    if (current.cause) pending.push(current.cause)
  }
  return [...codes]
}

async function checkDatabase() {
  if (process.env.DB_CONNECTION && process.env.DB_CONNECTION !== 'pg') {
    throw new Error('Only PostgreSQL is supported. Set DB_CONNECTION=pg.')
  }

  if (process.env.DB_SSL && !['true', 'false'].includes(process.env.DB_SSL))
    throw new Error('DB_SSL must be true or false.')
  const host = process.env.DB_HOST?.trim()
  const port = Number(process.env.DB_PORT || 5432)
  const timeout = Number(process.env.DB_STARTUP_TIMEOUT_SECONDS || 30)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PostgreSQL requires DB_HOST and a valid DB_PORT (1–65535).')
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
    throw new Error('DB_STARTUP_TIMEOUT_SECONDS must be an integer between 1 and 300.')
  }

  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(
      '[startup] PostgreSQL DB_HOST points to this container. For a separate Compose service use its service name; for a host database on Docker Desktop use host.docker.internal.'
    )
  }

  const deadline = Date.now() + timeout * 1000
  const encounteredCodes = new Set()
  console.log(
    `[startup] Waiting up to ${timeout}s for PostgreSQL at ${JSON.stringify(host)}:${port}...`
  )
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
  const retryableCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'ENOTFOUND',
    '57P03',
  ])
  while (true) {
    let connection
    try {
      connection = new pg.Client({
        host,
        port,
        user: process.env.DB_USER,
        password,
        ssl,
        database: process.env.DB_DATABASE,
        connectionTimeoutMillis: Math.max(1, Math.min(5000, deadline - Date.now())),
      })
      await connection.connect()
      console.log(`[startup] PostgreSQL connection ready at ${JSON.stringify(host)}:${port}.`)
      return
    } catch (error) {
      const codes = errorCodes(error)
      for (const code of codes) encounteredCodes.add(code)
      const retryable = codes.length > 0 && codes.every((code) => retryableCodes.has(code))
      const failure = new Error(
        `Cannot connect to PostgreSQL at ${JSON.stringify(host)}:${port}: ${[...encounteredCodes].join(', ') || 'connection failed'}. Check DB_HOST/DB_PORT, server availability, and DB credentials.`
      )
      if (!retryable || Date.now() >= deadline) {
        throw failure
      }
      await setTimeout(Math.min(1000, Math.max(0, deadline - Date.now())))
      if (Date.now() >= deadline) throw failure
    } finally {
      await connection?.end().catch(() => {})
    }
  }
}

try {
  await checkDatabase()
} catch (error) {
  console.error(`[startup] ${error.message}`)
  process.exitCode = 1
}

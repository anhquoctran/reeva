import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'

const buildRoot = join(process.cwd(), 'build')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'reeva-production-smoke-'))
const adminEmail = 'production-smoke@example.invalid'
const adminPassword = 'production-smoke-password-0123456789'
const portServer = createServer()

await new Promise((resolve, reject) => {
  portServer.once('error', reject)
  portServer.listen(0, '127.0.0.1', resolve)
})
const { port } = portServer.address()
await new Promise((resolve) => portServer.close(resolve))

const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'error',
  APP_KEY: randomBytes(32).toString('hex'),
  APP_URL: origin,
  SESSION_DRIVER: 'cookie',
  DB_CONNECTION: 'sqlite',
  SQLITE_DATABASE_PATH: join(temporaryRoot, 'smoke.sqlite3'),
  MAIL_MAILER: 'smtp',
  MAIL_FROM_NAME: 'Reeva Runtime Smoke',
  MAIL_FROM_ADDRESS: adminEmail,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: adminPassword,
}

function runAce(...args) {
  const result = spawnSync(process.execPath, [join(buildRoot, 'ace.js'), ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
  if (args[0] === 'db:seed' && (result.stdout || result.stderr)) {
    process.stdout.write(`${result.stdout}${result.stderr}`)
  }
}

function sessionCookies(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0])
}

let server
let serverOutput = ''
try {
  runAce('migration:run', '--force')
  runAce('db:seed')

  server = spawn(process.execPath, [join(buildRoot, 'bin/server.js')], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => (serverOutput += chunk))
  server.stderr.on('data', (chunk) => (serverOutput += chunk))

  let loginPage
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Production server exited:\n${serverOutput}`)
    try {
      loginPage = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2_000) })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.ok(loginPage, `Production server did not start:\n${serverOutput}`)
  assert.equal(loginPage.status, 200)

  const loginHtml = await loginPage.text()
  const csrf = loginHtml.match(
    /<input\b(?=[^>]*\bname=['"]_csrf['"])(?=[^>]*\bvalue=['"]([^'"]+)['"])[^>]*>/
  )?.[1]
  assert.ok(
    csrf,
    `Login page must render a CSRF field: ${loginHtml.slice(loginHtml.indexOf('<form'), loginHtml.indexOf('<form') + 600)}`
  )

  const loginCookies = sessionCookies(loginPage)
  assert.ok(loginCookies.length, 'Login page must establish a session')
  const loginResponse = await fetch(`${origin}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'cookie': loginCookies.join('; '),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ email: adminEmail, password: adminPassword, _csrf: csrf }),
  })
  assert.equal(loginResponse.status, 302, 'Root login must redirect after success')

  const cookieJar = new Map(loginCookies.map((cookie) => [cookie.split('=', 1)[0], cookie]))
  for (const cookie of sessionCookies(loginResponse)) {
    cookieJar.set(cookie.split('=', 1)[0], cookie)
  }

  if (loginResponse.headers.get('location') === '/') {
    const followUpLogin = await fetch(`${origin}/login`, {
      headers: { cookie: [...cookieJar.values()].join('; ') },
    })
    const followUpHtml = await followUpLogin.text()
    assert.fail(
      `Root login returned to /; invalid credentials shown=${followUpHtml.includes('Invalid email or password.')}; cookies=${[...cookieJar.keys()].join(',')}`
    )
  }

  const authenticatedHeaders = { cookie: [...cookieJar.values()].join('; ') }
  for (const [path, expectedContent] of [
    ['/cms/software', 'Manage the products whose OTA releases are hosted by Reeva'],
    ['/cms/versions', 'Deploy releases for the selected software.'],
    ['/cms/artifacts', 'Reeva'],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: authenticatedHeaders,
      signal: AbortSignal.timeout(5_000),
    })
    const html = await response.text()
    assert.equal(
      response.status,
      200,
      `${path} must render for a root user (redirect=${response.headers.get('location')}): ${html.slice(0, 300)}`
    )
    assert.ok(html.includes(expectedContent), `${path} must include its expected page content`)
  }

  const invalidScopedCheck = await fetch(
    `${origin}/api/software/reeva/check?platform=linux&arch=x64&version=invalid`
  )
  assert.equal(invalidScopedCheck.status, 400)

  const unknownSoftware = await fetch(
    `${origin}/api/software/missing/latest?platform=linux&arch=x64`
  )
  assert.equal(unknownSoftware.status, 404)

  const invalidLegacyCheck = await fetch(
    `${origin}/api/check?platform=linux&arch=x64&version=invalid`
  )
  assert.equal(invalidLegacyCheck.status, 400)

  process.stdout.write(
    'production smoke passed: fresh SQLite migration + seed, login/CSRF, root software/version/artifact pages, scoped and legacy API validation\n'
  )
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, cp, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { HashManager } from '@adonisjs/core/hash'
import { Scrypt } from '@adonisjs/core/hash/drivers/scrypt'
import { chromium } from 'playwright'
import { createTestDatabase } from './postgres_test_helpers.mjs'

const database = await createTestDatabase('production')
const buildRoot = join(process.cwd(), 'build')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'reeva-production-smoke-'))
const isolatedBuildRoot = join(temporaryRoot, 'build')
const adminEmail = 'production-smoke@example.invalid'
const adminPassword = 'production-smoke-password-0123456789'
const portServer = createServer()

const smokePort = Number(process.env.REEVA_SMOKE_PORT || 8888)
assert.ok(Number.isInteger(smokePort) && smokePort >= 1 && smokePort <= 65535)
const origin = `http://127.0.0.1:${smokePort}`
const env = {
  ...database.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'debug',
  APP_KEY: randomBytes(32).toString('hex'),
  APP_URL: origin,
  SESSION_DRIVER: process.env.REEVA_SMOKE_SESSION_DRIVER || 'cookie',
  // An explicit password takes precedence over an unused password-file path.
  DB_PASSWORD_FILE: '/reeva-synthetic-unused-password-file',
  MAIL_MAILER: 'smtp',
  MAIL_FROM_NAME: 'Reeva Runtime Smoke',
  MAIL_FROM_ADDRESS: adminEmail,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: adminPassword,
}
if (smokePort === 8888) delete env.PORT
else env.PORT = String(smokePort)

function runAce(...args) {
  const result = spawnSync(process.execPath, [join(isolatedBuildRoot, 'ace.js'), ...args], {
    cwd: isolatedBuildRoot,
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

function runSourceAce(...args) {
  const result = spawnSync(process.execPath, ['ace', ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
  if (result.stdout || result.stderr) process.stdout.write(`${result.stdout}${result.stderr}`)
}

async function findChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    chromium.executablePath(),
  ].filter(Boolean)
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter((path) => path && path !== '0')

  for (const root of cacheRoots) {
    try {
      for (const version of await readdir(root)) {
        if (!version.startsWith('chromium-')) continue
        candidates.push(
          join(root, version, 'chrome-linux', 'chrome'),
          join(root, version, 'chrome-linux64', 'chrome'),
          join(root, version, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          join(
            root,
            version,
            'chrome-mac-arm64',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing'
          )
        )
      }
    } catch {}
  }

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }

  throw new Error(
    'Chromium is required for the production browser smoke. Install it with `pnpm exec playwright install chromium` or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.'
  )
}

let server
let serverOutput = ''
try {
  await cp(buildRoot, isolatedBuildRoot, {
    recursive: true,
    filter: (source) => !source.endsWith('/.env'),
  })
  await symlink(join(process.cwd(), 'node_modules'), join(isolatedBuildRoot, 'node_modules'), 'dir')

  await new Promise((resolve, reject) => {
    portServer.once('error', reject)
    portServer.listen(smokePort, '127.0.0.1', resolve)
  })
  await new Promise((resolve) => portServer.close(resolve))

  runAce('migration:run', '--force')
  runAce('db:seed')
  const seededAdmin = (
    await database.client.query(
      'SELECT is_active,is_root,password_hash FROM users WHERE email=$1',
      [adminEmail]
    )
  ).rows[0]
  assert.ok(
    seededAdmin?.is_active && seededAdmin.is_root,
    'Root seeder must persist an active root account with a password hash.'
  )
  const passwordHasher = new HashManager({
    default: 'scrypt',
    list: {
      scrypt: () =>
        new Scrypt({ cost: 16384, blockSize: 8, parallelization: 1, maxMemory: 33_554_432 }),
    },
  })
  assert.ok(
    await passwordHasher.verify(seededAdmin.password_hash, adminPassword),
    'Root seeder password must verify against its stored Scrypt hash.'
  )
  runSourceAce('test', '--files=tests/unit/production_seeded_login.spec.ts')

  server = spawn(process.execPath, [join(isolatedBuildRoot, 'bin/server.js')], {
    cwd: isolatedBuildRoot,
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

  const browser = await chromium.launch({
    headless: true,
    executablePath: await findChromiumExecutable(),
  })
  try {
    const page = await browser.newPage()
    const pageLogin = await page.goto(`${origin}/login`)
    assert.equal(pageLogin?.status(), 200)
    assert.equal(await page.locator('input[name="_csrf"]').count(), 1)
    await page.evaluate(
      ({ email, password }) => {
        document.querySelector('input[name="email"]').value = email
        document.querySelector('input[name="password"]').value = password
        document.querySelector('form').requestSubmit()
      },
      { email: adminEmail, password: adminPassword }
    )
    await page.waitForURL(`${origin}/cms`, { timeout: 5_000 })

    for (const [path, expectedContent] of [
      ['/cms/software', 'Manage the products whose OTA releases are hosted by Reeva'],
      ['/cms/versions', 'Deploy releases for the selected software.'],
      ['/cms/artifacts', 'Reeva'],
      ['/cms', 'Reeva'],
      ['/cms/storage', 'Storage'],
      ['/cms/storage/create', 'Add Storage Provider'],
      ['/cms/licenses', 'License'],
    ]) {
      const response = await page.goto(`${origin}${path}`)
      const html = await page.content()
      assert.equal(
        response?.status(),
        200,
        `${path} must render for a root user (url=${page.url()}): ${html.slice(0, 300)}\n${serverOutput}`
      )
      assert.ok(html.includes(expectedContent), `${path} must include its expected page content`)
    }

    await page.goto(`${origin}/cms/storage`)
    const editPath = await page
      .locator('a[href*="/cms/storage/"][href$="/edit"]')
      .first()
      .getAttribute('href')
    assert.ok(editPath, 'Storage page must link to a provider edit page.')
    const editResponse = await page.goto(new URL(editPath, origin).toString())
    const editHtml = await page.content()
    assert.equal(editResponse?.status(), 200)
    assert.ok(editHtml.includes('Configure Storage Provider'))
    assert.ok(editHtml.includes('does not copy stored objects'))
  } finally {
    await browser.close()
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
    `production smoke passed: no .env, ${smokePort === 8888 ? 'default port 8888' : `PORT override ${smokePort}`}, PostgreSQL migration + seed, ${env.SESSION_DRIVER} sessions, Chromium login/CSRF, CMS software/version/artifact/dashboard/storage/create/edit/license pages, scoped and legacy API validation\n`
  )
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  await rm(temporaryRoot, { recursive: true, force: true })
  await database.close()
}

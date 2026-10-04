import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const source = process.cwd()
const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
assert.equal(listing.status, 0, 'Run from the repository root.')
const directory = await mkdtemp(join(tmpdir(), 'reeva-pg-compose-'))
const project = directory.split('/').at(-1).toLowerCase()
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  COMPOSE_PROJECT_NAME: project,
  HOST_PORT: '0',
}
// Docker Desktop/remote engine selection is retained, application secrets are not.
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
]) {
  if (process.env[key]) env[key] = process.env[key]
}

function compose(args, { check = true, inherit = false } = {}) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: directory,
    env,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout: 300000,
  })
  if (check && result.status !== 0)
    throw new Error(
      `Compose ${args[0]} failed: ${result.stderr || result.error?.message || result.status}`
    )
  return result.stdout?.trim()
}

async function ready() {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const rows = compose(['ps', '--format', 'json'])
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row))
    if (rows.length === 2 && rows.every((row) => row.Health === 'healthy')) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Disposable Compose services did not become healthy. Inspect their startup logs.')
}

function sql(query) {
  return compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'reeva', '-tAc', query])
}

function credentialFingerprint() {
  // Capture only a combined digest internally; neither digest nor secrets are logged.
  return compose([
    'exec',
    '-T',
    'app',
    'node',
    '--input-type=module',
    '-e',
    "import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';let content='';for(const path of ['/app/secrets/db_password','/app/storage/.app_key'])content+=await readFile(path);console.log(createHash('sha256').update(content).digest('hex'))",
  ])
}

try {
  for (const file of new Set(listing.stdout.split('\0').filter(Boolean))) {
    const target = join(directory, file)
    await mkdir(dirname(target), { recursive: true })
    try {
      await copyFile(join(source, file), target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    } // removed tracked files
  }
  // Even an accidentally tracked dot-env is excluded from this synthetic run.
  for (const name of ['.env', '.env.local', '.env.production', '.env.test']) {
    await rm(join(directory, name), { force: true })
  }
  compose(['up', '-d', '--build'], { inherit: true })
  await ready()
  const publishedAddress = compose(['port', 'app', '8888'])
  const publishedPort = Number(publishedAddress.slice(publishedAddress.lastIndexOf(':') + 1))
  assert.ok(
    Number.isInteger(publishedPort) && publishedPort > 0,
    'Compose must publish a host port.'
  )
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${publishedPort}/login`, {
        signal: AbortSignal.timeout(5000),
      })
    ).status,
    200
  )
  assert.equal(sql('SELECT count(*) FROM adonis_schema'), '29')
  assert.equal(
    sql(
      "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='reeva'"
    ),
    'f'
  )
  const fingerprint = credentialFingerprint()
  sql(
    "INSERT INTO settings (id,key,value) VALUES (gen_random_uuid(),'compose_test_persistence','retained')"
  )
  compose(['restart', 'postgres', 'app'])
  await ready()
  assert.equal(sql("SELECT value FROM settings WHERE key='compose_test_persistence'"), 'retained')
  assert.equal(credentialFingerprint(), fingerprint)
  await writeFile(join(directory, '.env'), 'DB_CONNECTION=mysql\nDB_HOST=localhost\nDB_PORT=3306\n')
  compose(['up', '-d', '--build'])
  await ready()
  assert.equal(credentialFingerprint(), fingerprint)
  assert.equal(
    compose([
      'exec',
      '-T',
      'app',
      'node',
      '-e',
      "console.log(process.env.DB_CONNECTION+' '+process.env.DB_HOST+' '+process.env.DB_PORT)",
    ]),
    'pg postgres 5432'
  )
  assert.equal(sql("SELECT value FROM settings WHERE key='compose_test_persistence'"), 'retained')
  console.log(
    `Compose passed: one-command startup/default container port 8888 (temporary host port ${publishedPort}), healthy PostgreSQL/app, 29 migrations, nonsuperuser role, persistent data/key/password, legacy DB overrides ignored.`
  )
} finally {
  // Only this script's randomly named synthetic project is removed.
  compose(['down', '-v'], { check: false })
  spawnSync('docker', ['image', 'rm', `${project}-app`], { env, stdio: 'ignore' })
  await rm(directory, { recursive: true, force: true })
}

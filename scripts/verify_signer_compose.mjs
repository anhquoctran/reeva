import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verifySignerStack } from './verify_signer_stack.mjs'

const directory = await mkdtemp(join(tmpdir(), 'reeva-signer-check-'))
const project = directory.split('/').at(-1).toLowerCase()
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  COMPOSE_PROJECT_NAME: project,
}
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
]) {
  if (process.env[key]) environment[key] = process.env[key]
}
function docker(args, { check = true, inherit = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: directory,
    env: environment,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout: 600000,
  })
  if (check && result.status !== 0)
    throw new Error(
      `Synthetic signer check failed: ${result.stderr || result.error?.message || result.status}`
    )
  return result.stdout?.trim()
}
function compose(args, options) {
  if (args[0] === 'exec' && args[2] === 'app') {
    // An isolated caller with only the requester role; no Reeva DB/app build is
    // needed for this independent Rust/custody integration check.
    return docker(
      [
        'run',
        '--rm',
        '--user',
        '1000',
        '--network',
        `${project}_default`,
        '-v',
        `${project}_signer_trust:/app/signer-trust:ro`,
        '-v',
        `${project}_signer_requester:/app/signer-requester:ro`,
        '--entrypoint',
        'node',
        `${project}-signer-admin`,
        ...args.slice(4),
      ],
      options
    )
  }
  return docker(['compose', ...args], options)
}
try {
  const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  })
  assert.equal(listing.status, 0)
  for (const file of new Set(listing.stdout.split('\0').filter(Boolean))) {
    if (/^\.env(?:\.|$)/.test(file)) continue
    const target = join(directory, file)
    await mkdir(dirname(target), { recursive: true })
    try {
      await copyFile(join(process.cwd(), file), target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  compose(['build', 'signer', 'signer-secrets'], { inherit: true })
  compose(['up', '-d', '--no-build', 'signer', 'openbao'])
  let healthy = false
  for (let attempt = 0; attempt < 90; attempt++) {
    const rows = compose(['ps', '--format', 'json'])
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row))
    if (
      ['signer', 'signer-postgres', 'openbao'].every((service) =>
        rows.some((row) => row.Service === service && row.Health === 'healthy')
      )
    ) {
      healthy = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  assert.equal(healthy, true, 'Synthetic signer stack must become live.')
  await verifySignerStack(compose, { verifyReevaConsumer: false })
  console.log(
    'Standalone Rust/custody Compose check passed; Reeva application build/consumer is checked separately by verify:docker-compose.'
  )
} catch (error) {
  console.error(compose(['logs', '--tail=60', 'signer', 'openbao'], { check: false }))
  throw error
} finally {
  compose(['down', '-v'], { check: false })
  docker(['image', 'rm', `${project}-signer`, `${project}-signer-admin`], { check: false })
  await rm(directory, { recursive: true, force: true })
}

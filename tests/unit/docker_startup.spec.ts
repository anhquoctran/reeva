import { test } from '@japa/runner'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { join } from 'node:path'

function runPreflight(values: Record<string, string>) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'scripts/check_database_connection.mjs')],
      {
        env: { ...process.env, ...values },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let output = ''
    child.stdout.on('data', (data) => (output += data.toString()))
    child.stderr.on('data', (data) => (output += data.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

test.group('Docker database startup', () => {
  test('reports IPv4/IPv6 connection refusal within the deadline without credentials', async ({
    assert,
  }) => {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP port.')
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const started = Date.now()
    const result = await runPreflight({
      DB_CONNECTION: 'pg',
      DB_HOST: 'localhost',
      DB_PORT: String(address.port),
      DB_USER: 'synthetic-private-user',
      DB_PASSWORD: 'synthetic-private-password',
      DB_STARTUP_TIMEOUT_SECONDS: '1',
    })
    assert.equal(result.code, 1)
    assert.include(result.output, 'ECONNREFUSED')
    assert.include(result.output, 'host.docker.internal')
    assert.include(result.output, `"localhost":${address.port}`)
    assert.notInclude(result.output, 'synthetic-private-user')
    assert.notInclude(result.output, 'synthetic-private-password')
    assert.isBelow(Date.now() - started, 5000)
  })

  test('rejects an unsupported backend before connecting', async ({ assert }) => {
    const result = await runPreflight({ DB_CONNECTION: 'mysql', DB_HOST: 'unreachable.invalid' })
    assert.equal(result.code, 1)
    assert.include(result.output, 'Only PostgreSQL is supported')
  })

  test('connects to PostgreSQL and reports bad authentication without leaking credentials', async ({
    assert,
  }) => {
    const success = await runPreflight({ DB_CONNECTION: 'pg' })
    assert.equal(success.code, 0)
    assert.include(success.output, 'PostgreSQL connection ready')
    const failed = await runPreflight({
      DB_PASSWORD: 'synthetic-wrong-password',
      DB_PASSWORD_FILE: '',
    })
    assert.equal(failed.code, 1)
    assert.include(failed.output, '28P01')
    assert.notInclude(failed.output, 'synthetic-wrong-password')
    assert.notInclude(failed.output, process.env.DB_PASSWORD!)
  })
})

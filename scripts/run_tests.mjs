import { spawn } from 'node:child_process'
import { createTestDatabase } from './postgres_test_helpers.mjs'

const database = await createTestDatabase('japa')
try {
  const child = spawn(process.execPath, ['ace', 'test', ...process.argv.slice(2)], {
    env: { ...database.env, NODE_ENV: 'test' },
    stdio: 'inherit',
  })
  const stop = () => child.kill('SIGTERM')
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => resolve(code ?? 1))
    })
    process.exitCode = code
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
} finally {
  await database.close()
}

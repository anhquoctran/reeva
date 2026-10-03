import { randomBytes } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'

async function persist(directory, name, value, mode) {
  await mkdir(directory, { recursive: true })
  const path = `${directory}/${name}`
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporary, `${value}\n`, { flag: 'wx', mode })
  try {
    await link(temporary, path)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  } finally {
    await unlink(temporary)
  }
  return (await readFile(path, 'utf8')).trim()
}

const user = process.env.POSTGRES_USER || 'reeva'
const database = process.env.POSTGRES_DB || 'reeva'
if (user === 'postgres' || ['postgres', 'template0', 'template1'].includes(database)) {
  throw new Error('Use a dedicated PostgreSQL application role and database.')
}
const identity = JSON.stringify({ user, database })
if ((await persist('/app/secrets', 'identity.json', identity, 0o444)) !== identity) {
  throw new Error(
    'PostgreSQL identity differs from the initialized volume. Migrate explicitly; existing volumes were preserved.'
  )
}
const configured = process.env.POSTGRES_PASSWORD
if (configured && (configured.trim() !== configured || /[\r\n]/.test(configured))) {
  throw new Error('POSTGRES_PASSWORD must not contain newlines or surrounding whitespace.')
}
const stored = await persist(
  '/app/secrets',
  'db_password',
  configured || randomBytes(32).toString('hex'),
  0o444
)
if (!stored) throw new Error('Persistent database password is empty.')
if (configured && configured !== stored) {
  throw new Error(
    'POSTGRES_PASSWORD differs from the initialized password. Rotate the database role password and secret file together; existing volumes were preserved.'
  )
}
await persist('/app/admin-secrets', 'postgres_password', randomBytes(32).toString('hex'), 0o600)
console.log('[startup] Persistent PostgreSQL credential is ready.')

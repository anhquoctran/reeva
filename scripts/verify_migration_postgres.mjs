import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from './postgres_test_helpers.mjs'

const database = await createTestDatabase('migrations')
const { client, env } = database
const auth = '1777000000000_create_auth_rate_limits_and_upload_reservations'
const software = '1777100000000_add_software_products'
const invariants = '1777200000000_postgresql_release_invariants'
function ace(...args) {
  const result = spawnSync(process.execPath, ['ace', ...args, '--no-schema-generate'], {
    env,
    encoding: 'utf8',
    timeout: 30000,
  })
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  return result.stdout
}
try {
  ace('migration:run')
  const { rows: migrations } = await client.query('SELECT name FROM adonis_schema ORDER BY name')
  assert.equal(migrations.length, 29)
  for (const [name, batch] of [
    [auth, 2],
    [software, 3],
    [invariants, 4],
  ]) {
    const updated = await client.query('UPDATE adonis_schema SET batch=$1 WHERE name LIKE $2', [
      batch,
      `%${name}%`,
    ])
    assert.equal(updated.rowCount, 1)
  }
  ace('migration:rollback', '--batch=1')
  assert.equal(
    (await client.query("SELECT to_regclass('auth_rate_limits') AS table_name")).rows[0].table_name,
    null
  )
  assert.equal(
    (await client.query("SELECT to_regclass('software') AS table_name")).rows[0].table_name,
    null
  )
  const userId = randomUUID()
  const versionId = randomUUID()
  await client.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId,
    'legacy@example.invalid',
    'synthetic-hash',
  ])
  await client.query(
    "INSERT INTO remember_me_tokens (tokenable_id,hash,created_at,updated_at,expires_at) VALUES ($1,'synthetic',now(),now(),now()+interval '30 days')",
    [userId]
  )
  await client.query('INSERT INTO settings (id,key,value) VALUES ($1,$2,$3)', [
    randomUUID(),
    'appName',
    'Legacy Desktop',
  ])
  await client.query(
    "INSERT INTO versions (id,major,minor,patch,changelog,is_active) VALUES ($1,7,8,9,'Existing release',true)",
    [versionId]
  )
  ace('migration:run')
  assert.equal(
    (await client.query('SELECT auth_version FROM users WHERE id=$1', [userId])).rows[0]
      .auth_version,
    0
  )
  assert.equal((await client.query('SELECT count(*) FROM remember_me_tokens')).rows[0].count, '0')
  const product = (await client.query("SELECT * FROM software WHERE slug='reeva'")).rows[0]
  assert.equal(product.name, 'Legacy Desktop')
  assert.equal(product.is_default, true)
  const version = (await client.query('SELECT * FROM versions WHERE id=$1', [versionId])).rows[0]
  assert.equal(version.software_id, product.id)
  assert.deepEqual([version.major, version.minor, version.patch], [7, 8, 9])
  const type = (
    await client.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='remember_me_tokens' AND column_name='tokenable_id'"
    )
  ).rows[0].data_type
  assert.equal(type, 'uuid')
  const otherProduct = randomUUID()
  const otherVersion = randomUUID()
  await client.query("INSERT INTO software (id,name,slug) VALUES ($1,'Other','other')", [
    otherProduct,
  ])
  await client.query(
    'INSERT INTO versions (id,software_id,major,minor,patch) VALUES ($1,$2,7,8,9)',
    [otherVersion, otherProduct]
  )
  for (const [name, batch] of [
    [auth, 2],
    [software, 3],
    [invariants, 4],
  ])
    await client.query('UPDATE adonis_schema SET batch=$1 WHERE name LIKE $2', [batch, `%${name}%`])
  const guarded = spawnSync(
    process.execPath,
    ['ace', 'migration:rollback', '--batch=2', '--no-schema-generate'],
    { env, encoding: 'utf8', timeout: 30000 }
  )
  assert.equal(guarded.status, 1)
  assert.match(guarded.stdout + guarded.stderr, /Cannot roll back software products/)
  assert.equal(
    (
      await client.query('SELECT count(*) FROM versions WHERE id IN ($1,$2)', [
        versionId,
        otherVersion,
      ])
    ).rows[0].count,
    '2'
  )
  ace('migration:run')
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM pg_indexes WHERE indexname IN ('uq_software_default','idx_download_histories_live_created')"
      )
    ).rows[0].count,
    '2'
  )
  await client.query('DELETE FROM versions WHERE id=$1', [otherVersion])
  await client.query('DELETE FROM software WHERE id=$1', [otherProduct])
  ace('migration:reset')
  ace('migration:run')
  assert.equal((await client.query('SELECT count(*) FROM adonis_schema')).rows[0].count, '29')
  console.log(
    'PostgreSQL migrations passed: fresh 29 migrations, additive rollback/seeded upgrade, UUID FK, preserved user/version, token revocation, duplicate-semver rollback guard, full reset/reapply on disposable DB.'
  )
} finally {
  await database.close()
}

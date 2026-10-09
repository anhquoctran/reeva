import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createTestDatabase } from './postgres_test_helpers.mjs'

// Focused SQL overhead comparison, not HTTP throughput or cryptographic testing.
// Both variants use the same valid signed rows and indexes in a disposable DB.
const source = await readFile('app/repositories/artifact_repository.ts', 'utf8')
const comparison = source.match(
  /\.whereRaw\(`(artifacts\.signature_manifest = jsonb_build_object\([\s\S]*?\))`\)/
)?.[1]
assert.ok(comparison, 'Benchmark must read the current production manifest predicate.')
const database = await createTestDatabase('signature_benchmark')
try {
  const client = database.client
  await client.query(`
    CREATE TABLE software (id integer PRIMARY KEY, slug text NOT NULL, require_signed_updates boolean NOT NULL);
    INSERT INTO software VALUES (1, 'benchmark-product', true);
    CREATE TABLE platforms (id integer PRIMARY KEY, name text NOT NULL);
    CREATE TABLE architectures (id integer PRIMARY KEY, name text NOT NULL);
    INSERT INTO platforms VALUES (1,'linux');
    INSERT INTO architectures VALUES (1,'x64');
    CREATE TABLE versions (id integer PRIMARY KEY, software_id integer, major integer, minor integer, patch integer, codename text, changelog text);
    CREATE INDEX benchmark_semver ON versions(major DESC,minor DESC,patch DESC);
    CREATE TABLE artifacts (id integer PRIMARY KEY, version_id integer, platform_id integer, architecture_id integer, channel text, file_name text, size_bytes bigint, checksum_sha256 text, signature text, signature_key_id text, signature_manifest jsonb);
    CREATE INDEX benchmark_version ON artifacts(version_id);
    CREATE TABLE software_signing_keys (software_id integer, key_id text PRIMARY KEY, is_active boolean);
    INSERT INTO software_signing_keys VALUES(1, repeat('b',64),true);
    INSERT INTO versions SELECT id,1,1,(id-1)/1000,(id-1)%1000,NULL,'Synthetic release notes' FROM generate_series(1,100000) id;
    INSERT INTO artifacts SELECT id,id,1,1,'stable','app.bin',67108864,repeat('a',64),'synthetic-presence-only',repeat('b',64),NULL FROM generate_series(1,100000) id;
    UPDATE artifacts SET signature_manifest=jsonb_build_object(
      'schemaVersion',1,'software','benchmark-product',
      'version',concat(v.major,'.',v.minor,'.',v.patch),
      'codename',v.codename,'changelog',v.changelog,'channel',channel,
      'platform','linux','architecture','x64','fileName',file_name,
      'sizeBytes',size_bytes,'sha256',checksum_sha256)
      FROM versions v WHERE v.id=artifacts.version_id;
    ANALYZE;
  `)
  // Keep the production correlated EXISTS / OR shape. Moving the JSON
  // comparison onto a top-level join changes selectivity and the query plan.
  const base = (snapshot) => `FROM artifacts
    JOIN versions v ON v.id=artifacts.version_id
    WHERE EXISTS(SELECT 1 FROM versions eligible_versions
      JOIN software eligible_software ON eligible_software.id=eligible_versions.software_id
      WHERE eligible_versions.id=artifacts.version_id AND
      (eligible_software.require_signed_updates=false OR EXISTS(
        SELECT 1 FROM software_signing_keys k
        WHERE k.software_id=eligible_software.id AND k.key_id=artifacts.signature_key_id
          AND k.is_active AND artifacts.signature IS NOT NULL
          ${snapshot ? `AND ${comparison}` : ''})))`
  const operations = {
    latest: (snapshot) =>
      `SELECT artifacts.id ${base(snapshot)} ORDER BY v.major DESC,v.minor DESC,v.patch DESC LIMIT 1`,
    count: (snapshot) => `SELECT count(*) AS total ${base(snapshot)}`,
    page: (snapshot) =>
      `SELECT artifacts.id ${base(snapshot)} ORDER BY v.major DESC,v.minor DESC,v.patch DESC LIMIT 20`,
  }
  const output = { rows: 100000, warmups: 3, samples: 25, results: {} }
  for (const [name, build] of Object.entries(operations)) {
    const sql = [build(false), build(true)]
    const reference = await client.query(sql[0])
    assert.deepEqual((await client.query(sql[1])).rows, reference.rows)
    for (let warmup = 0; warmup < 3; warmup++) for (const query of sql) await client.query(query)
    const samples = [[], []]
    for (let run = 0; run < 25; run++) {
      for (const variant of run % 2 === 0 ? [0, 1] : [1, 0]) {
        const start = performance.now()
        await client.query(sql[variant])
        samples[variant].push(performance.now() - start)
      }
    }
    const result = samples.map((values) => {
      values.sort((a, b) => a - b)
      return { p50Ms: Number(values[12].toFixed(3)), p95Ms: Number(values[23].toFixed(3)) }
    })
    output.results[name] = {
      signaturePresence: result[0],
      currentSnapshot: result[1],
      queries: 1,
      returnedRows: reference.rowCount,
    }
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await database.close()
}

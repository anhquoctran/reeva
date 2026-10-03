import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { createTestDatabase } from './postgres_test_helpers.mjs'

const MiB = 1024 * 1024
const root =
  process.argv[2] === '--storage-worker'
    ? undefined
    : await mkdtemp(join(tmpdir(), 'reeva-benchmark-'))

function percentile(values, percentileValue) {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1)]
}

function summary(samples) {
  return {
    p50Ms: Number(
      percentile(
        samples.map((sample) => sample.ms),
        50
      ).toFixed(2)
    ),
    p95Ms: Number(
      percentile(
        samples.map((sample) => sample.ms),
        95
      ).toFixed(2)
    ),
    medianMiBPerSecond: Number(
      percentile(
        samples.map((sample) => sample.mibPerSecond),
        50
      ).toFixed(2)
    ),
    peakRssMiB: Math.max(...samples.map((sample) => sample.peakRssMiB)),
  }
}

if (process.argv[2] === '--storage-worker') {
  const [, , , mode, concurrencyText, sourcePath, outputRoot] = process.argv
  const concurrency = Number(concurrencyText)
  const fileSize = (await import('node:fs/promises')).stat(sourcePath).then((stat) => stat.size)
  const bytes = await fileSize
  const started = performance.now()

  async function hashStream() {
    const hashes = ['md5', 'sha1', 'sha256', 'sha512'].map((name) => createHash(name))
    for await (const chunk of createReadStream(sourcePath)) {
      for (const hash of hashes) hash.update(chunk)
    }
    for (const hash of hashes) hash.digest()
  }

  await Promise.all(
    Array.from({ length: concurrency }, async (_, index) => {
      const target = join(outputRoot, `${mode}-${index}`)
      if (mode === 'buffer-copy') {
        const contents = await (await import('node:fs/promises')).readFile(sourcePath)
        for (const name of ['md5', 'sha1', 'sha256', 'sha512']) {
          createHash(name).update(contents).digest()
        }
        await writeFile(target, contents, { flag: 'wx' })
      } else {
        await hashStream()
        await pipeline(
          createReadStream(sourcePath),
          (await import('node:fs')).createWriteStream(target, { flags: 'wx' })
        )
      }
      await rm(target)
    })
  )

  const ms = performance.now() - started
  process.stdout.write(
    JSON.stringify({
      ms,
      mibPerSecond: (bytes * concurrency) / MiB / (ms / 1000),
      peakRssMiB: process.resourceUsage().maxRSS / 1024,
    })
  )
} else {
  try {
    const sourcePath = join(root, 'source.bin')
    const chunk = Buffer.alloc(1 * MiB, 0x5a)
    await writeFile(sourcePath, Buffer.alloc(0))
    const sourceHandle = await (await import('node:fs/promises')).open(sourcePath, 'w')
    for (let offset = 0; offset < 64; offset++) await sourceHandle.write(chunk)
    await sourceHandle.close()

    const storageResults = {}
    for (const concurrency of [1, 4]) {
      const samples = { 'buffer-copy': [], 'stream-pipeline': [] }
      for (let run = 0; run < 7; run++) {
        const modes =
          run % 2 === 0 ? ['buffer-copy', 'stream-pipeline'] : ['stream-pipeline', 'buffer-copy']
        for (const mode of modes) {
          const result = spawnSync(
            process.execPath,
            [import.meta.filename, '--storage-worker', mode, String(concurrency), sourcePath, root],
            { encoding: 'utf8' }
          )
          if (result.status !== 0) throw new Error(result.stderr || result.stdout)
          samples[mode].push(JSON.parse(result.stdout))
        }
      }
      for (const mode of ['buffer-copy', 'stream-pipeline']) {
        storageResults[`${mode} x${concurrency}`] = summary(samples[mode])
      }
    }

    const database = await createTestDatabase('benchmark')
    try {
      const client = database.client
      await client.query(`
        CREATE TABLE software (id integer PRIMARY KEY, slug text NOT NULL, is_active boolean NOT NULL);
        INSERT INTO software VALUES (1,'product-one',true),(2,'product-two',true);
        CREATE TABLE versions (id integer PRIMARY KEY, major integer, minor integer, patch integer, is_active boolean, deleted_at timestamptz, software_id integer);
        CREATE INDEX idx_versions_semver ON versions(major,minor,patch);
        CREATE INDEX idx_versions_software_semver ON versions(software_id,is_active,major,minor,patch);
        CREATE TABLE platforms (id integer PRIMARY KEY,name text,deleted_at timestamptz);
        CREATE TABLE architectures (id integer PRIMARY KEY,name text,deleted_at timestamptz);
        CREATE TABLE storage_providers (id integer PRIMARY KEY,is_active boolean,deleted_at timestamptz);
        CREATE TABLE artifacts (id integer PRIMARY KEY,version_id integer,platform_id integer,architecture_id integer,storage_provider_id integer,channel text,is_published boolean,is_archived boolean,deleted_at timestamptz,published_at timestamptz);
        CREATE INDEX idx_artifacts_version ON artifacts(version_id);
        CREATE INDEX idx_artifacts_platform_arch ON artifacts(platform_id,architecture_id);
        CREATE INDEX idx_artifacts_provider ON artifacts(storage_provider_id);
        CREATE TABLE download_histories (id integer PRIMARY KEY,artifact_id integer,created_at timestamptz NOT NULL,deleted_at timestamptz);
        INSERT INTO platforms VALUES (1,'linux',NULL);
        INSERT INTO architectures VALUES (1,'x64',NULL);
        INSERT INTO storage_providers VALUES (1,true,NULL);
        INSERT INTO versions SELECT id,1,(id-1)/1000,(id-1)%1000,true,NULL,(id%2)+1 FROM generate_series(1,100000) id;
        INSERT INTO artifacts SELECT id,id,1,1,1,'stable',true,false,NULL,'2026-01-01'::timestamptz FROM generate_series(1,100000) id;
        INSERT INTO download_histories SELECT id,id,'2026-09-01'::timestamptz+(id%30)*interval '1 day'+(id%24)*interval '1 hour',NULL FROM generate_series(1,100000) id;
        ANALYZE;
      `)
      const joins = 'FROM artifacts a JOIN versions v ON v.id=a.version_id'
      const legacyBase = `${joins} JOIN platforms p ON p.id=a.platform_id JOIN architectures ar ON ar.id=a.architecture_id WHERE p.name='linux' AND ar.name='x64' AND a.channel='stable' AND a.is_published=true AND v.is_active=true`
      const publicBase = `${joins} WHERE a.platform_id=1 AND a.architecture_id=1 AND a.channel='stable' AND a.is_published=true AND a.is_archived=false AND a.deleted_at IS NULL AND v.is_active=true AND v.deleted_at IS NULL AND EXISTS (SELECT 1 FROM platforms p WHERE p.id=a.platform_id AND p.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM architectures ar WHERE ar.id=a.architecture_id AND ar.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM storage_providers sp WHERE sp.id=a.storage_provider_id AND sp.is_active=true AND sp.deleted_at IS NULL)`
      const semver =
        '(v.major>1 OR (v.major=1 AND v.minor>99) OR (v.major=1 AND v.minor=99 AND v.patch>997))'
      const order = 'ORDER BY v.major DESC,v.minor DESC,v.patch DESC'
      async function measure(label, queries) {
        async function work() {
          let result
          for (const query of queries) result = await client.query(query)
          return result.rowCount
        }
        for (let n = 0; n < 3; n++) await work()
        const samples = []
        let rows = 0
        for (let n = 0; n < 25; n++) {
          const started = performance.now()
          rows = await work()
          samples.push(performance.now() - started)
        }
        return {
          label,
          p50Ms: Number(percentile(samples, 50).toFixed(3)),
          p95Ms: Number(percentile(samples, 95).toFixed(3)),
          candidateRowsReturned: rows,
          queryCount: queries.length,
        }
      }
      const beforeCheck = await measure('legacy candidate loading on PostgreSQL', [
        `SELECT a.id,v.major,v.minor,v.patch ${legacyBase} ${order}`,
      ])
      const beforePage = await measure('legacy count + page on PostgreSQL', [
        `SELECT count(*) ${legacyBase}`,
        `SELECT a.id ${legacyBase} ${order} LIMIT 20 OFFSET 100`,
      ])
      await client.query(
        'CREATE INDEX idx_artifacts_public_release ON artifacts(platform_id,architecture_id,channel,is_published,is_archived,deleted_at,version_id,id); CREATE INDEX idx_download_histories_live_created ON download_histories(deleted_at,created_at); ANALYZE;'
      )
      const afterCheck = await measure('filtered public SQL on PostgreSQL', [
        `SELECT a.id,v.major,v.minor,v.patch ${publicBase} AND ${semver} ${order} LIMIT 1`,
      ])
      const afterPage = await measure('canonical count + page on PostgreSQL', [
        `SELECT count(*) ${publicBase}`,
        `SELECT a.id ${publicBase} ${order},a.id LIMIT 20 OFFSET 100`,
      ])
      const scoped = `${publicBase} AND v.software_id=1 AND EXISTS (SELECT 1 FROM software s WHERE s.id=v.software_id AND s.is_active=true)`
      const scopedCheck = await measure('software-scoped public SQL on PostgreSQL', [
        `SELECT a.id,v.major,v.minor,v.patch ${scoped} AND ${semver} ${order} LIMIT 1`,
      ])
      const scopedPage = await measure('software-scoped count + page on PostgreSQL', [
        `SELECT count(*) ${scoped}`,
        `SELECT a.id ${scoped} ${order},a.id LIMIT 20 OFFSET 100`,
      ])
      const dashboard = await measure('native UTC PostgreSQL dashboard bucket', [
        "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:00:00') AS hour,count(*) FROM download_histories WHERE deleted_at IS NULL AND created_at>='2026-08-31' GROUP BY hour ORDER BY hour",
      ])
      console.log(
        JSON.stringify(
          {
            workload: {
              syntheticRows: 100000,
              backend: 'PostgreSQL 17, disposable DB',
              integerFixtureIds: true,
              samples: 25,
              warmup: 3,
              softwareProducts: 2,
              storageFileMiB: 64,
              storageSamples: 7,
            },
            storage: storageResults,
            database: {
              updateCheck: { before: beforeCheck, after: afterCheck },
              releasesPage: { before: beforePage, after: afterPage },
              softwareScope: { updateCheck: scopedCheck, releasesPage: scopedPage },
              dashboard,
            },
            rssMiB: process.memoryUsage().rss / MiB,
          },
          null,
          2
        )
      )
    } finally {
      await database.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

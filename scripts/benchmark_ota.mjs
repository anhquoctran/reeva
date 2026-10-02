import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'

const MiB = 1024 * 1024
const root = await mkdtemp(join(tmpdir(), 'reeva-benchmark-'))

function percentile(values, percentileValue) {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1)]
}

function summary(samples) {
  return {
    p50Ms: Number(percentile(samples.map((sample) => sample.ms), 50).toFixed(2)),
    p95Ms: Number(percentile(samples.map((sample) => sample.ms), 95).toFixed(2)),
    medianMiBPerSecond: Number(
      percentile(samples.map((sample) => sample.mibPerSecond), 50).toFixed(2)
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
        await pipeline(createReadStream(sourcePath), (await import('node:fs')).createWriteStream(target, { flags: 'wx' }))
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
          run % 2 === 0
            ? ['buffer-copy', 'stream-pipeline']
            : ['stream-pipeline', 'buffer-copy']
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

    const dbPath = join(root, 'workload.sqlite3')
    const sqlite = new Database(dbPath)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.exec(`
      CREATE TABLE software (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, is_active INTEGER NOT NULL);
      INSERT INTO software VALUES (1, 'product-one', 1), (2, 'product-two', 1);
      CREATE TABLE versions (id INTEGER PRIMARY KEY, major INTEGER NOT NULL, minor INTEGER NOT NULL, patch INTEGER NOT NULL, is_active INTEGER NOT NULL, deleted_at TEXT, software_id INTEGER NOT NULL);
      CREATE INDEX idx_versions_semver ON versions(major, minor, patch);
      CREATE INDEX idx_versions_software_semver ON versions(software_id, is_active, major, minor, patch);
      CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE architectures (id INTEGER PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE storage_providers (id INTEGER PRIMARY KEY, is_active INTEGER NOT NULL, deleted_at TEXT);
      CREATE TABLE artifacts (id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL, platform_id INTEGER NOT NULL, architecture_id INTEGER NOT NULL, storage_provider_id INTEGER NOT NULL, channel TEXT NOT NULL, is_published INTEGER NOT NULL, is_archived INTEGER NOT NULL, deleted_at TEXT, published_at TEXT);
      CREATE INDEX idx_artifacts_version ON artifacts(version_id);
      CREATE INDEX idx_artifacts_platform_arch ON artifacts(platform_id, architecture_id);
      CREATE INDEX idx_artifacts_provider ON artifacts(storage_provider_id);
      CREATE TABLE download_histories (id INTEGER PRIMARY KEY, artifact_id INTEGER NOT NULL, created_at TEXT NOT NULL);
    `)
    sqlite.exec(`INSERT INTO platforms VALUES (1, 'linux', NULL); INSERT INTO architectures VALUES (1, 'x64', NULL); INSERT INTO storage_providers VALUES (1, 1, NULL);`)
    const insert = sqlite.transaction(() => {
      const version = sqlite.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, 1, NULL, ?)')
      const artifact = sqlite.prepare('INSERT INTO artifacts VALUES (?, ?, 1, 1, 1, \'stable\', 1, 0, NULL, \'2026-01-01 00:00:00\')')
      const history = sqlite.prepare('INSERT INTO download_histories VALUES (?, ?, ?)')
      for (let id = 1; id <= 100_000; id++) {
        const major = 1
        const minor = Math.floor((id - 1) / 1000)
        const patch = (id - 1) % 1000
        version.run(id, major, minor, patch, (id % 2) + 1)
        artifact.run(id, id)
        history.run(id, id, `2026-09-${String(1 + (id % 30)).padStart(2, '0')} ${String(id % 24).padStart(2, '0')}:00:00`)
      }
    })
    insert()

    const joins = `FROM artifacts AS a JOIN versions AS v ON v.id = a.version_id`
    const legacyBase = `${joins} JOIN platforms AS p ON p.id = a.platform_id JOIN architectures AS ar ON ar.id = a.architecture_id WHERE p.name = 'linux' AND ar.name = 'x64' AND a.channel = 'stable' AND a.is_published = 1 AND v.is_active = 1`
    const publicBase = `${joins} WHERE a.platform_id = 1 AND a.architecture_id = 1 AND a.channel = 'stable' AND a.is_published = 1 AND a.is_archived = 0 AND a.deleted_at IS NULL AND v.is_active = 1 AND v.deleted_at IS NULL AND EXISTS (SELECT 1 FROM platforms AS p WHERE p.id = a.platform_id AND p.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM architectures AS ar WHERE ar.id = a.architecture_id AND ar.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM storage_providers AS sp WHERE sp.id = a.storage_provider_id AND sp.deleted_at IS NULL AND sp.is_active = 1)`
    const legacyCheck = sqlite.prepare(`SELECT a.id, v.major, v.minor, v.patch ${legacyBase} ORDER BY v.major DESC, v.minor DESC, v.patch DESC`)
    const legacyPage = sqlite.prepare(`SELECT a.id ${legacyBase} ORDER BY v.major DESC, v.minor DESC, v.patch DESC LIMIT 20 OFFSET 100`)
    const legacyCount = sqlite.prepare(`SELECT count(*) AS total ${legacyBase}`)

function measure(label, work, queryCount = 1) {
      const samples = []
      let rowCount = 0
      for (let warmup = 0; warmup < 3; warmup++) work()
      for (let iteration = 0; iteration < 25; iteration++) {
        const started = performance.now()
        rowCount = work()
        samples.push(performance.now() - started)
      }
      return {
        label,
        p50Ms: Number(percentile(samples, 50).toFixed(3)),
        p95Ms: Number(percentile(samples, 95).toFixed(3)),
        candidateRowsReturned: rowCount,
        queryCount,
      }
    }

    const oldCheckResult = measure('update check before: load all candidates, then scan', () => {
      const rows = legacyCheck.all()
      return rows.length
    })
    const oldReleasesResult = measure('releases before: count + page (legacy eligibility)', () => {
      legacyCount.get()
      return legacyPage.all().length
    }, 2)

    sqlite.exec('CREATE INDEX idx_artifacts_public_release ON artifacts(platform_id, architecture_id, channel, is_published, is_archived, deleted_at, version_id, id)')
    const publicCheck = sqlite.prepare(`SELECT a.id, v.major, v.minor, v.patch ${publicBase} AND (v.major > 1 OR (v.major = 1 AND v.minor > 99) OR (v.major = 1 AND v.minor = 99 AND v.patch > 997)) ORDER BY v.major DESC, v.minor DESC, v.patch DESC LIMIT 1`)
    const publicPage = sqlite.prepare(`SELECT a.id ${publicBase} ORDER BY v.major DESC, v.minor DESC, v.patch DESC, a.id ASC LIMIT 20 OFFSET 100`)
    const publicCount = sqlite.prepare(`SELECT count(*) AS total ${publicBase}`)
    const scopedPublicBase = `${publicBase} AND v.software_id = 1 AND EXISTS (SELECT 1 FROM software AS s WHERE s.id = v.software_id AND s.is_active = 1)`
    const scopedCheck = sqlite.prepare(`SELECT a.id, v.major, v.minor, v.patch ${scopedPublicBase} AND (v.major > 1 OR (v.major = 1 AND v.minor > 99) OR (v.major = 1 AND v.minor = 99 AND v.patch > 997)) ORDER BY v.major DESC, v.minor DESC, v.patch DESC LIMIT 1`)
    const scopedPage = sqlite.prepare(`SELECT a.id ${scopedPublicBase} ORDER BY v.major DESC, v.minor DESC, v.patch DESC, a.id ASC LIMIT 20 OFFSET 100`)
    const scopedCount = sqlite.prepare(`SELECT count(*) AS total ${scopedPublicBase}`)
    const newCheckResult = measure('update check after: filter and limit in SQL', () => publicCheck.all().length)
    const newReleasesResult = measure('releases after: count + page (shared eligibility)', () => {
      publicCount.get()
      return publicPage.all().length
    }, 2)
    const scopedCheckResult = measure('update check with software scope', () => scopedCheck.all().length)
    const scopedReleasesResult = measure('releases with software scope: count + page', () => {
      scopedCount.get()
      return scopedPage.all().length
    }, 2)

    const oldDashboardStarted = performance.now()
    let oldDashboard = 'unsupported'
    try {
      sqlite.prepare('SELECT HOUR(created_at), count(*) FROM download_histories GROUP BY HOUR(created_at)').all()
      oldDashboard = 'unexpectedly supported'
    } catch (error) {
      oldDashboard = `${error.message}`
    }
    const oldDashboardMs = performance.now() - oldDashboardStarted
    const dashboardChart = sqlite.prepare("SELECT strftime('%Y-%m-%d %H:00:00', created_at) AS hour, count(*) AS total FROM download_histories WHERE created_at >= '2026-08-31 00:00:00' GROUP BY hour ORDER BY hour")
    const dashboardSamples = []
    let dashboardRows = 0
    for (let warmup = 0; warmup < 3; warmup++) dashboardRows = dashboardChart.all().length
    for (let iteration = 0; iteration < 25; iteration++) {
      const started = performance.now()
      dashboardRows = dashboardChart.all().length
      dashboardSamples.push(performance.now() - started)
    }
    sqlite.close()

    process.stdout.write(
      JSON.stringify(
        {
          workload: { syntheticRows: 100_000, sqlite: sqlite.name, storageFileMiB: 64, storageSamples: 7 },
          storage: storageResults,
          database: {
            updateCheck: { before: oldCheckResult, after: newCheckResult },
            releasesPage: { before: oldReleasesResult, after: newReleasesResult },
            softwareScope: {
              workload: 'same 100,000 release rows split evenly across two active software products',
              updateCheck: scopedCheckResult,
              releasesPage: scopedReleasesResult,
            },
            dashboard: {
              before: { status: oldDashboard, elapsedMs: Number(oldDashboardMs.toFixed(3)) },
              after: {
                p50Ms: Number(percentile(dashboardSamples, 50).toFixed(3)),
                p95Ms: Number(percentile(dashboardSamples, 95).toFixed(3)),
                groupedRows: dashboardRows,
                queryCount: 1,
              },
            },
          },
        },
        null,
        2
      )
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

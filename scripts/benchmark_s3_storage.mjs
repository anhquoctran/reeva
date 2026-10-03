import assert from 'node:assert/strict'
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import S3CompatibleProvider from '../build/app/services/storage/providers/s3_compatible_provider.js'
import { normalizeS3CompatibleConfig } from '../build/app/services/storage/s3_compatible_config.js'

const createTemporaryBucket = process.env.S3_BENCH_CREATE_BUCKET === 'true'
if (process.env.S3_BENCH_CREATE_BUCKET && !createTemporaryBucket) {
  throw new Error('S3_BENCH_CREATE_BUCKET must be true or unset.')
}
const bucket = createTemporaryBucket
  ? `reeva-benchmark-${randomUUID().replaceAll('-', '').slice(0, 20)}`
  : process.env.S3_BENCH_BUCKET
const config = normalizeS3CompatibleConfig({
  endpoint: process.env.S3_BENCH_ENDPOINT,
  region: process.env.S3_BENCH_REGION || 'us-east-1',
  bucket,
  accessKeyId: process.env.S3_BENCH_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_BENCH_SECRET_ACCESS_KEY,
  sessionToken: process.env.S3_BENCH_SESSION_TOKEN,
  forcePathStyle: process.env.S3_BENCH_FORCE_PATH_STYLE || 'auto',
  maxAttempts: Number(process.env.S3_BENCH_MAX_ATTEMPTS || '1'),
})
assert.ok(config.accessKeyId && config.secretAccessKey, 'Use explicit test-only benchmark keys.')

const fileBytes = Number(process.env.S3_BENCH_FILE_BYTES || 64 * 1024 * 1024)
const repetitions = Number(process.env.S3_BENCH_REPETITIONS || 8)
const concurrencyLevels = (process.env.S3_BENCH_CONCURRENCIES || '1,4')
  .split(',')
  .map((value) => Number(value.trim()))
assert.ok(Number.isSafeInteger(fileBytes) && fileBytes >= 16 * 1024 * 1024)
assert.ok(Number.isInteger(repetitions) && repetitions >= 3 && repetitions <= 20)
assert.ok(
  concurrencyLevels.length > 0 &&
    concurrencyLevels.every((value) => Number.isInteger(value) && value >= 1 && value <= 32),
  'S3_BENCH_CONCURRENCIES must be comma-separated integers between 1 and 32.'
)

const provider = new S3CompatibleProvider(config)
const client = new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  forcePathStyle: config.forcePathStyle,
  maxAttempts: config.maxAttempts,
  requestHandler: {
    connectionTimeout: config.connectionTimeoutMs,
    socketTimeout: config.socketTimeoutMs,
  },
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const runId = randomUUID()
const chunk = Buffer.alloc(1024 * 1024, 0x5a)
const expectedHash = createHash('sha256')
for (let bytes = 0; bytes < fileBytes; bytes += chunk.length) {
  expectedHash.update(chunk.subarray(0, Math.min(chunk.length, fileBytes - bytes)))
}
const expectedSha256 = expectedHash.digest('hex')
const makeSource = () =>
  Readable.from(
    (async function* () {
      for (let bytes = 0; bytes < fileBytes; bytes += chunk.length) {
        yield chunk.subarray(0, Math.min(chunk.length, fileBytes - bytes))
      }
    })()
  )

async function measureOne(key) {
  try {
    const uploadStartedAt = performance.now()
    await provider.upload(makeSource(), {
      key,
      fileName: 'benchmark.bin',
      contentType: 'application/octet-stream',
      contentLength: fileBytes,
    })
    const uploadMs = performance.now() - uploadStartedAt
    const afterUpload = process.memoryUsage()

    const downloadStartedAt = performance.now()
    const stream = await provider.getStream(key)
    const checksum = createHash('sha256')
    let receivedBytes = 0
    for await (const piece of stream) {
      receivedBytes += piece.byteLength
      checksum.update(piece)
    }
    const downloadMs = performance.now() - downloadStartedAt
    const afterDownload = process.memoryUsage()
    assert.equal(receivedBytes, fileBytes, 'Download byte count must match uploaded size.')
    assert.equal(checksum.digest('hex'), expectedSha256, 'Downloaded payload checksum must match.')

    return { uploadMs, downloadMs, afterUpload, afterDownload }
  } finally {
    await provider.delete(key).catch(() => {})
  }
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]
}

const baselineRss = process.memoryUsage.rss()
let peakRss = baselineRss
const rssSampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage.rss())
}, 10)
const results = []
let bucketCreated = false

try {
  if (createTemporaryBucket) {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
    bucketCreated = true
  }

  for (const concurrency of concurrencyLevels) {
    const uploadTimes = []
    const downloadTimes = []
    const afterUploadMemory = []
    const afterDownloadMemory = []
    const concurrencyRssBaseline = process.memoryUsage.rss()
    let concurrencyPeakRss = concurrencyRssBaseline
    const concurrencyRssSampler = setInterval(() => {
      concurrencyPeakRss = Math.max(concurrencyPeakRss, process.memoryUsage.rss())
    }, 5)
    const startedAt = performance.now()

    try {
      for (let offset = 0; offset < repetitions; offset += concurrency) {
        const batchSize = Math.min(concurrency, repetitions - offset)
        const batch = Array.from({ length: batchSize }, (_, index) => {
          const sample = offset + index
          const key = `reeva-benchmark/${runId}/c${concurrency}-${sample}`
          return measureOne(key)
        })
        const outcomes = await Promise.allSettled(batch)
        const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
        for (const outcome of outcomes) {
          if (outcome.status !== 'fulfilled') continue
          const measurement = outcome.value
          uploadTimes.push(measurement.uploadMs)
          downloadTimes.push(measurement.downloadMs)
          afterUploadMemory.push(measurement.afterUpload)
          afterDownloadMemory.push(measurement.afterDownload)
        }
      }
    } finally {
      clearInterval(concurrencyRssSampler)
      concurrencyPeakRss = Math.max(concurrencyPeakRss, process.memoryUsage.rss())
    }

    const elapsedMs = performance.now() - startedAt
    const p50UploadMs = percentile(uploadTimes, 0.5)
    const p95UploadMs = percentile(uploadTimes, 0.95)
    const p50DownloadMs = percentile(downloadTimes, 0.5)
    const p95DownloadMs = percentile(downloadTimes, 0.95)
    results.push({
      concurrency,
      samples: repetitions,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      rssBaselineBytes: concurrencyRssBaseline,
      rssPeakBytes: concurrencyPeakRss,
      rssPeakDeltaBytes: Math.max(0, concurrencyPeakRss - concurrencyRssBaseline),
      afterUploadRssPeakBytes: Math.max(...afterUploadMemory.map((sample) => sample.rss)),
      afterDownloadRssPeakBytes: Math.max(...afterDownloadMemory.map((sample) => sample.rss)),
      afterUploadExternalPeakBytes: Math.max(...afterUploadMemory.map((sample) => sample.external)),
      afterDownloadExternalPeakBytes: Math.max(
        ...afterDownloadMemory.map((sample) => sample.external)
      ),
      upload: {
        p50Ms: Number(p50UploadMs.toFixed(2)),
        p95Ms: Number(p95UploadMs.toFixed(2)),
        p50MiBPerSecond: Number((fileBytes / 1024 / 1024 / (p50UploadMs / 1000)).toFixed(2)),
      },
      download: {
        p50Ms: Number(p50DownloadMs.toFixed(2)),
        p95Ms: Number(p95DownloadMs.toFixed(2)),
        p50MiBPerSecond: Number((fileBytes / 1024 / 1024 / (p50DownloadMs / 1000)).toFixed(2)),
      },
    })
  }
} finally {
  clearInterval(rssSampler)
  if (bucketCreated) {
    await client.send(new DeleteBucketCommand({ Bucket: config.bucket })).catch(() => {})
  }
  client.destroy()
  process.stdout.write(
    JSON.stringify(
      {
        endpointConfigured: Boolean(config.endpoint),
        temporaryBucketCreated: createTemporaryBucket,
        fileBytes,
        repetitions,
        rssBaselineBytes: baselineRss,
        rssPeakBytes: peakRss,
        rssPeakDeltaBytes: Math.max(0, peakRss - baselineRss),
        results,
      },
      null,
      2
    ) + '\n'
  )
}

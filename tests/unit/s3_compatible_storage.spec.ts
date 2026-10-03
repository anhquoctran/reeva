import { test } from '@japa/runner'
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import type StorageProvider from '#models/storage_provider'
import StorageManager from '#services/storage/storage_manager'
import S3CompatibleProvider from '#services/storage/providers/s3_compatible_provider'
import {
  normalizeS3CompatibleConfig,
  s3CompatibleConfigFromEnvironment,
} from '#services/storage/s3_compatible_config'

async function withTransientNetworkRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const value = error as {
        name?: string
        code?: string
        cause?: { code?: string }
        $metadata?: { httpStatusCode?: number }
      }
      const transportCode = value.code || value.cause?.code
      const retryable =
        !value.$metadata?.httpStatusCode &&
        (value.name === 'TimeoutError' ||
          ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(transportCode || ''))

      if (!retryable || attempt === 7) throw error
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }

  throw new Error('S3 service did not become ready.')
}

async function collect(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function setEnvironment(values: Record<string, string>) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test.group('S3-compatible object storage', () => {
  test('streams SigV4 upload/download/delete through the environment-backed provider', async ({
    assert,
  }) => {
    const objectBody = Buffer.from('synthetic OTA artifact contents')
    const requests: Array<{
      method: string
      path: string
      authorization: string
      headers: unknown
    }> = []
    let storedObject = Buffer.alloc(0)
    let hangPutResponse = false
    const server: Server = createServer((request, response) => {
      requests.push({
        method: request.method || '',
        path: request.url || '',
        authorization: request.headers.authorization || '',
        headers: request.headers,
      })

      if (request.method === 'PUT') {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          storedObject = Buffer.concat(chunks)
          if (hangPutResponse) return
          response.statusCode = 200
          response.setHeader('etag', '"synthetic-etag"')
          response.end('<PutObjectResult/>')
        })
        return
      }

      if (request.method === 'GET') {
        response.statusCode = 200
        response.setHeader('content-length', String(storedObject.length))
        response.setHeader('content-type', 'application/octet-stream')
        response.end(storedObject)
        return
      }

      if (request.method === 'DELETE') {
        storedObject = Buffer.alloc(0)
        response.statusCode = 204
        response.end()
        return
      }

      response.statusCode = 501
      response.end()
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port.')
    const port = (address as AddressInfo).port

    const restoreEnvironment = setEnvironment({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'reeva-test-bucket',
      S3_ACCESS_KEY_ID: 'synthetic-access-key',
      S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      S3_SESSION_TOKEN: 'synthetic-session-token',
      S3_FORCE_PATH_STYLE: 'auto',
      S3_MAX_ATTEMPTS: '1',
      S3_CONNECTION_TIMEOUT_MS: '100',
      S3_SOCKET_TIMEOUT_MS: '100',
      S3_DOWNLOAD_URL_TTL_SECONDS: '300',
    })

    try {
      const config = s3CompatibleConfigFromEnvironment()
      assert.isTrue(config.forcePathStyle)
      assert.equal(config.endpoint, `http://127.0.0.1:${port}`)
      assert.equal(config.connectionTimeoutMs, 100)
      assert.equal(config.socketTimeoutMs, 100)

      // This DB row contains only the source marker; credentials are resolved
      // at request time and never need to be saved into the provider config.
      const provider = StorageManager.resolve({
        type: 'cloud',
        config: { driver: 's3', configSource: 'environment' },
      } as unknown as StorageProvider)
      const key = 'artifacts/synthetic id/payload.zip'
      await provider.upload(Readable.from([objectBody]), {
        key,
        fileName: 'payload.zip',
        contentType: 'application/octet-stream',
        contentLength: objectBody.length,
      })

      assert.deepEqual(storedObject, objectBody)
      assert.deepEqual(await collect(await provider.getStream(key)), objectBody)

      const signedUrl = new URL(await provider.getDownloadUrl(key))
      assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '300')
      assert.isNotNull(signedUrl.searchParams.get('X-Amz-Signature'))
      assert.equal(signedUrl.searchParams.get('X-Amz-Security-Token'), 'synthetic-session-token')

      await provider.delete(key)
      assert.equal(storedObject.length, 0)
      assert.deepEqual(
        requests.map((request) => request.method),
        ['PUT', 'GET', 'DELETE']
      )
      for (const request of requests) {
        assert.match(request.authorization, /^AWS4-HMAC-SHA256 Credential=synthetic-access-key\//)
        assert.include(request.path, '/reeva-test-bucket/artifacts/synthetic%20id/payload.zip')
        const headers = request.headers as Record<string, string | string[] | undefined>
        assert.isUndefined(headers['x-amz-sdk-checksum-algorithm'])
        assert.isUndefined(headers['x-amz-checksum-crc32'])
      }

      hangPutResponse = true
      let timeoutError: Error | undefined
      try {
        await provider.upload(Readable.from([Buffer.from('wait')]), {
          key: 'artifacts/timeout/payload.zip',
          fileName: 'payload.zip',
          contentType: 'application/octet-stream',
          contentLength: 4,
        })
      } catch (error) {
        timeoutError = error as Error
      }
      if (!timeoutError) throw new Error('Stalled S3 response did not time out.')
      assert.isTrue(
        timeoutError.name === 'TimeoutError' || /timeout|socket hang up/i.test(timeoutError.message)
      )
    } finally {
      restoreEnvironment()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  test('normalizes existing MinIO/SeaweedFS JSON and validates credentials/endpoints', ({
    assert,
  }) => {
    const minio = normalizeS3CompatibleConfig(
      {
        bucket: 'reeva-artifacts',
        endpoint: 'minio.internal',
        port: 9000,
        useSSL: false,
        accessKey: 'synthetic-access-key',
        secretKey: 'synthetic-secret-key',
      },
      'minio'
    )
    assert.equal(minio.endpoint, 'http://minio.internal:9000')
    assert.isTrue(minio.forcePathStyle)
    assert.equal(minio.accessKeyId, 'synthetic-access-key')
    assert.equal(minio.connectionTimeoutMs, 10_000)
    assert.equal(minio.socketTimeoutMs, 120_000)

    const seaweed = normalizeS3CompatibleConfig(
      { bucket: 'reeva', endpoint: 'https://s3.internal:8333', region: 'us-east-1' },
      'seaweedfs'
    )
    assert.equal(seaweed.endpoint, 'https://s3.internal:8333')
    assert.isTrue(seaweed.forcePathStyle)

    assert.throws(
      () =>
        normalizeS3CompatibleConfig({
          bucket: 'reeva',
          accessKeyId: 'only-one-half-of-the-pair',
        }),
      'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.'
    )
    assert.throws(
      () =>
        normalizeS3CompatibleConfig({
          bucket: 'reeva',
          endpoint: 'https://user:password@s3.internal/bucket',
        }),
      'S3_ENDPOINT must use HTTP or HTTPS without credentials, query, or fragment.'
    )
    assert.throws(
      () => normalizeS3CompatibleConfig({ bucket: 'reeva', forcePathStyle: 'sometimes' }),
      'S3_FORCE_PATH_STYLE must be one of auto, true, or false.'
    )
    assert.throws(
      () => normalizeS3CompatibleConfig({ bucket: 'reeva', socketTimeoutMs: 700_000 }),
      'S3_SOCKET_TIMEOUT_MS must be an integer between 1 and 600000.'
    )
  })

  test('builds vendor endpoint styles for Cloudflare R2 and OCI', async ({ assert }) => {
    const r2 = new S3CompatibleProvider({
      bucket: 'reeva-artifacts',
      endpoint: 'https://1234567890abcdef.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
      forcePathStyle: false,
    })
    const r2Url = new URL(await r2.getDownloadUrl('builds/latest.zip'))
    assert.equal(r2Url.hostname, 'reeva-artifacts.1234567890abcdef.r2.cloudflarestorage.com')

    const ociPath = new S3CompatibleProvider({
      bucket: 'reeva-artifacts',
      endpoint: 'https://reeva-namespace.compat.objectstorage.us-ashburn-1.oci.customer-oci.com',
      region: 'us-ashburn-1',
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
      forcePathStyle: true,
    })
    const ociPathUrl = new URL(await ociPath.getDownloadUrl('builds/latest.zip'))
    assert.equal(
      ociPathUrl.hostname,
      'reeva-namespace.compat.objectstorage.us-ashburn-1.oci.customer-oci.com'
    )
    assert.equal(ociPathUrl.pathname, '/reeva-artifacts/builds/latest.zip')

    const ociVirtual = new S3CompatibleProvider({
      bucket: 'reeva-artifacts',
      endpoint: 'https://vhcompat.objectstorage.us-ashburn-1.oci.customer-oci.com',
      region: 'us-ashburn-1',
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
      forcePathStyle: false,
    })
    const ociVirtualUrl = new URL(await ociVirtual.getDownloadUrl('builds/latest.zip'))
    assert.equal(
      ociVirtualUrl.hostname,
      'reeva-artifacts.vhcompat.objectstorage.us-ashburn-1.oci.customer-oci.com'
    )
    assert.equal(ociVirtualUrl.pathname, '/builds/latest.zip')
  })

  const integrationTest = test('integrates with a disposable S3-compatible endpoint', async ({
    assert,
  }) => {
    const endpoint = process.env.REEVA_TEST_S3_ENDPOINT
    assert.isString(endpoint)

    const bucket = `reeva-test-${randomUUID().replaceAll('-', '').slice(0, 20)}`
    const config = normalizeS3CompatibleConfig({
      bucket,
      endpoint,
      region: process.env.REEVA_TEST_S3_REGION || 'us-east-1',
      accessKeyId: process.env.REEVA_TEST_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.REEVA_TEST_S3_SECRET_ACCESS_KEY,
      sessionToken: process.env.REEVA_TEST_S3_SESSION_TOKEN,
      forcePathStyle: process.env.REEVA_TEST_S3_FORCE_PATH_STYLE || 'auto',
      maxAttempts: 1,
    })
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      maxAttempts: config.maxAttempts,
      requestHandler: {
        connectionTimeout: config.connectionTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
      },
      credentials: config.accessKeyId
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey!,
            ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
          }
        : undefined,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })

    // Some self-hosted gateways bind their listener before the API is ready.
    // Retry only transport errors; auth/configuration responses fail at once.
    await withTransientNetworkRetry(() => client.send(new CreateBucketCommand({ Bucket: bucket })))
    const provider = StorageManager.resolve({
      type: 'cloud',
      config: {
        driver: 's3',
        bucket,
        endpoint: config.endpoint,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
        forcePathStyle: config.forcePathStyle,
        maxAttempts: 1,
      },
    } as unknown as StorageProvider)
    const key = `artifacts/${randomUUID()}/payload.zip`
    const contents = Buffer.from('synthetic S3-compatible integration payload')

    try {
      await provider.upload(Readable.from([contents]), {
        key,
        fileName: 'payload.zip',
        contentType: 'application/octet-stream',
        contentLength: contents.length,
      })
      assert.deepEqual(await collect(await provider.getStream(key)), contents)

      const signedUrl = new URL(await provider.getDownloadUrl(key))
      const signedResponse = await fetch(signedUrl)
      assert.equal(signedResponse.status, 200)
      assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()), contents)
    } finally {
      await provider.delete(key).catch(() => {})
      await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {})
      client.destroy()
    }
  })
  integrationTest.skip(
    !process.env.REEVA_TEST_S3_ENDPOINT,
    'Set REEVA_TEST_S3_ENDPOINT to a disposable test-only S3-compatible service.'
  )
})

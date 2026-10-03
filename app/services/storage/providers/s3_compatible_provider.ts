import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { BaseStorageProvider, UploadOptions } from '../base_storage_provider.js'
import { normalizeS3CompatibleConfig, type S3CompatibleConfig } from '../s3_compatible_config.js'

const MAX_CACHED_CLIENTS = 32
const s3Clients = new Map<string, S3Client>()

function getS3Client(config: S3CompatibleConfig) {
  // Resolve the default AWS credential chain once per provider configuration,
  // and avoid creating a new HTTP connection pool for every artifact request.
  const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex')
  const cached = s3Clients.get(fingerprint)
  if (cached) {
    s3Clients.delete(fingerprint)
    s3Clients.set(fingerprint, cached)
    return cached
  }

  const credentials = config.accessKeyId
    ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey!,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      }
    : undefined

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials,
    maxAttempts: config.maxAttempts,
    requestHandler: {
      connectionTimeout: config.connectionTimeoutMs,
      socketTimeout: config.socketTimeoutMs,
    },
    // Retain Reeva's SHA checksums while avoiding optional CRC headers some
    // otherwise S3-compatible providers do not yet implement consistently.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  s3Clients.set(fingerprint, client)
  if (s3Clients.size > MAX_CACHED_CLIENTS) {
    const oldest = s3Clients.keys().next().value
    if (oldest) {
      s3Clients.get(oldest)?.destroy()
      s3Clients.delete(oldest)
    }
  }

  return client
}

export function shutdownS3CompatibleClients() {
  for (const client of s3Clients.values()) client.destroy()
  s3Clients.clear()
}

/**
 * One SigV4 S3 API implementation for AWS and S3-compatible object stores.
 * The bucket must exist before Reeva starts uploading artifacts.
 */
export default class S3CompatibleProvider implements BaseStorageProvider {
  private client: S3Client
  private bucket: string
  private downloadUrlTtlSeconds: number

  constructor(config: S3CompatibleConfig | unknown) {
    const normalized = normalizeS3CompatibleConfig(config)
    this.bucket = normalized.bucket
    this.downloadUrlTtlSeconds = normalized.downloadUrlTtlSeconds
    this.client = getS3Client(normalized)
  }

  async upload(file: Readable, options: UploadOptions): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
        Body: file,
        ContentLength: options.contentLength,
        ContentType: options.contentType,
      })
    )

    return { key: options.key }
  }

  async getDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: this.downloadUrlTtlSeconds,
    })
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!(response.Body instanceof Readable)) {
      throw new Error('S3-compatible storage returned no readable object body.')
    }
    return response.Body
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}

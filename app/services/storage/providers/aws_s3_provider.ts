import { type BaseStorageProvider } from '../base_storage_provider.js'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type Readable } from 'node:stream'
import type { UploadOptions } from '../base_storage_provider.js'

/**
 * AWSS3Provider handles file storage on Amazon S3.
 */
export default class AWSS3Provider implements BaseStorageProvider {
  private client: S3Client
  private bucket: string

  constructor(protected config: any) {
    this.bucket = config.bucket
    const credentials =
      config.accessKey && config.secretKey
        ? { accessKeyId: config.accessKey, secretAccessKey: config.secretKey }
        : undefined
    this.client = new S3Client({
      region: config.region || 'us-east-1',
      credentials,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle === true || config.forcePathStyle === 'true',
    })
  }

  /**
   * Uploads a file buffer to S3
   */
  async upload(file: Readable, options: UploadOptions): Promise<{ key: string }> {
    const { key } = options

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file,
      ContentLength: options.contentLength,
      ContentType: options.contentType,
    })

    await this.client.send(command)
    return { key }
  }

  /**
   * Generates a signed URL valid for 1 hour (3600 seconds)
   */
  async getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    // Securely signed URL that works even for private buckets
    return getSignedUrl(this.client, command, { expiresIn: 3600 })
  }

  /**
   * Returns a readable stream for high performance, proxied downloading
   */
  async getStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    const response = await this.client.send(command)
    if (!response.Body || !('pipe' in response.Body)) {
      throw new Error('Storage provider returned no readable object body.')
    }
    return response.Body as Readable
  }

  /**
   * Deletes an object from S3
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    await this.client.send(command)
  }
}

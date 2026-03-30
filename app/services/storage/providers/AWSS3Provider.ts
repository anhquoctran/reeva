import { BaseStorageProvider } from '../BaseStorageProvider.js'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

/**
 * AWSS3Provider handles file storage on Amazon S3.
 */
export default class AWSS3Provider implements BaseStorageProvider {
  private client: S3Client
  private bucket: string

  constructor(protected config: any) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle === true || config.forcePathStyle === 'true',
    })
  }

  /**
   * Uploads a file buffer to S3
   */
  async upload(file: Buffer, options?: any): Promise<{ key: string }> {
    const key = options?.key || `${crypto.randomUUID()}-${options?.fileName || 'untitled'}`

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file,
      ContentType: options?.contentType || 'application/octet-stream',
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

  /**
   * Moves an object to the archive folder in S3
   */
  async archive(key: string): Promise<void> {
    const archiveKey = `archive/${key}`

    // Copy to archive destination first
    const copyCommand = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: encodeURIComponent(`${this.bucket}/${key}`),
      Key: archiveKey,
    })

    await this.client.send(copyCommand)

    // Delete the original source object
    await this.delete(key)
  }
}

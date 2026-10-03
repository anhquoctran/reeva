import { type BaseStorageProvider } from '../base_storage_provider.js'

import * as Minio from 'minio'
import { type Readable } from 'node:stream'
import type { UploadOptions } from '../base_storage_provider.js'

/**
 * MinIOProvider handles file storage on MinIO server (S3 compatible).
 */
export default class MinIOProvider implements BaseStorageProvider {
  private client: Minio.Client

  constructor(protected config: any) {
    this.client = new Minio.Client({
      endPoint: config.endpoint,
      port: config.port ? Number(config.port) : undefined,
      useSSL: config.useSSL === true || config.useSSL === 'true',
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
    })
  }

  async upload(file: Readable, options: UploadOptions): Promise<{ key: string }> {
    const { key } = options
    const bucket = this.config.bucket

    const metaData: Minio.ItemBucketMetadata = {
      'Content-Type': options.contentType,
    }

    try {
      if (!(await this.client.bucketExists(bucket))) {
        await this.client.makeBucket(bucket, this.config.region || 'us-east-1')
      }
    } catch (_err) {
      // Ignore bucket creation warnings if lacks permission to list buckets
    }

    await this.client.putObject(bucket, key, file, options.contentLength, metaData)
    return { key }
  }

  async getDownloadUrl(key: string): Promise<string> {
    const protocol = this.config.useSSL === true || this.config.useSSL === 'true' ? 'https' : 'http'
    const portString = this.config.port ? `:${this.config.port}` : ''
    // Resolving as path-style access for MinIO natively
    return `${protocol}://${this.config.endpoint}${portString}/${this.config.bucket}/${key}`
  }

  async getStream(key: string): Promise<Readable> {
    return this.client.getObject(this.config.bucket, key)
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.config.bucket, key)
  }
}

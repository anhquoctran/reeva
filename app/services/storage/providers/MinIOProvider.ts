import { BaseStorageProvider } from '../BaseStorageProvider.js'

import * as Minio from 'minio'
import crypto from 'node:crypto'

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

  async upload(file: Buffer, options?: any): Promise<{ key: string }> {
    const key = options?.key || `${crypto.randomUUID()}-${options?.fileName || 'file'}`
    const bucket = this.config.bucket

    const metaData: Minio.ItemBucketMetadata = {
      'Content-Type': options?.contentType || 'application/octet-stream',
    }

    try {
      if (!(await this.client.bucketExists(bucket))) {
         await this.client.makeBucket(bucket, this.config.region || 'us-east-1')
      }
    } catch (_err) {
      // Ignore bucket creation warnings if lacks permission to list buckets
    }

    await this.client.putObject(bucket, key, file, file.length, metaData)
    return { key }
  }

  async getDownloadUrl(key: string): Promise<string> {
    const protocol = (this.config.useSSL === true || this.config.useSSL === 'true') ? 'https' : 'http'
    const portString = this.config.port ? `:${this.config.port}` : ''
    // Resolving as path-style access for MinIO natively
    return `${protocol}://${this.config.endpoint}${portString}/${this.config.bucket}/${key}`
  }

  async getStream(key: string): Promise<any> {
    return this.client.getObject(this.config.bucket, key)
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.config.bucket, key)
  }

  async archive(key: string): Promise<void> {
    const archiveKey = `archive/${key}`
    const conds = new Minio.CopyConditions()
    try {
      await this.client.copyObject(this.config.bucket, archiveKey, `${this.config.bucket}/${key}`, conds)
      await this.client.removeObject(this.config.bucket, key)
    } catch (_err) {}
  }
}

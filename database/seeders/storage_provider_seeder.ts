import { BaseSeeder } from '@adonisjs/lucid/seeders'
import StorageProvider from '#models/storage_provider'

export default class extends BaseSeeder {
  async run() {
    await StorageProvider.query().whereIn('type', ['minio', 's3', 'self-hosted', 'cloud']).delete()

    await StorageProvider.firstOrCreate(
      { type: 'local' },
      {
        name: 'Local Storage',
        type: 'local',
        config: {
          driver: 'local',
          root: 'd:/Quoc/repos/reeva/storage/uploads',
        },
        isDefault: true,
        isActive: true,
        quotaBytes: 10 * 1024 * 1024 * 1024,
      }
    )

    await StorageProvider.firstOrCreate(
      { name: 'MinIO Object Storage' },
      {
        name: 'MinIO Object Storage',
        type: 'self-hosted',
        config: {
          driver: 'minio',
          endpoint: 'play.min.io',
          accessKey: 'minioadmin',
          secretKey: 'minioadmin',
          bucket: 'reeva-artifacts',
          region: 'us-east-1',
          useSSL: true,
        },
        isDefault: false,
        isActive: false,
        quotaBytes: 10 * 1024 * 1024 * 1024,
      }
    )

    await StorageProvider.firstOrCreate(
      { name: 'Amazon S3' },
      {
        name: 'Amazon S3',
        type: 'cloud',
        config: {
          driver: 's3',
          region: 'us-east-1',
          accessKey: 'ACCESS_KEY_ID',
          secretKey: 'SECRET_ACCESS_KEY',
          bucket: 'my-s3-bucket',
        },
        isDefault: false,
        isActive: false,
        quotaBytes: 10 * 1024 * 1024 * 1024,
      }
    )
    await StorageProvider.firstOrCreate(
      { name: 'SeaweedFS' },
      {
        name: 'SeaweedFS',
        type: 'self-hosted',
        config: {
          driver: 'seaweedfs',
          endpoint: 'localhost',
          port: 8333,
          accessKey: 'ANY_ACCESS_KEY',
          secretKey: 'ANY_SECRET_KEY',
          bucket: 'reeva',
          useSSL: false,
        },
        isDefault: false,
        isActive: false,
        quotaBytes: 10 * 1024 * 1024 * 1024,
      }
    )
  }
}

import { BaseSeeder } from '@adonisjs/lucid/seeders'
import StorageProvider from '#models/storage_provider'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSeeder {
  async run() {
    await db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 2)')
      const currentDefault = await StorageProvider.query({ client: trx })
        .where('isDefault', true)
        .first()
      const localProvider = await StorageProvider.firstOrCreate(
        { type: 'local' },
        {
          name: 'Local Storage',
          type: 'local',
          config: {
            driver: 'local',
            root: path.join(process.cwd(), 'storage', 'uploads'),
          },
          isDefault: !currentDefault,
          isActive: true,
          quotaBytes: 10 * 1024 * 1024 * 1024,
        },
        { client: trx }
      )
      if (!currentDefault && !localProvider.isDefault) {
        localProvider.isDefault = true
        localProvider.isActive = true
        await localProvider.useTransaction(trx).save()
      }

      await StorageProvider.firstOrCreate(
        { name: 'MinIO Object Storage' },
        {
          name: 'MinIO Object Storage',
          type: 'self-hosted',
          config: {
            driver: 'minio',
            endpoint: 'localhost',
            bucket: 'reeva-artifacts',
            region: 'us-east-1',
            useSSL: true,
          },
          isDefault: false,
          isActive: false,
          quotaBytes: 10 * 1024 * 1024 * 1024,
        },
        { client: trx }
      )

      await StorageProvider.firstOrCreate(
        { name: 'Amazon S3' },
        {
          name: 'Amazon S3',
          type: 'cloud',
          config: {
            driver: 's3',
            region: 'us-east-1',
            bucket: '',
          },
          isDefault: false,
          isActive: false,
          quotaBytes: 10 * 1024 * 1024 * 1024,
        },
        { client: trx }
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
            bucket: 'reeva',
            useSSL: false,
          },
          isDefault: false,
          isActive: false,
          quotaBytes: 10 * 1024 * 1024 * 1024,
        },
        { client: trx }
      )
    })
  }
}

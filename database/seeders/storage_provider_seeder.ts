import { BaseSeeder } from '@adonisjs/lucid/seeders'
import StorageProvider from '#models/storage_provider'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { s3CompatibleConfigFromEnvironment } from '#services/storage/s3_compatible_config'

export default class extends BaseSeeder {
  async run() {
    await StorageProvider.firstOrCreate(
      { type: 'local' },
      {
        name: 'Local Storage',
        type: 'local',
        config: {
          driver: 'local',
          root: path.join(process.cwd(), 'storage', 'uploads'),
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
          endpoint: 'localhost',
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
          bucket: '',
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
          bucket: 'reeva',
          useSSL: false,
        },
        isDefault: false,
        isActive: false,
        quotaBytes: 10 * 1024 * 1024 * 1024,
      }
    )

    if (env.get('STORAGE_DRIVER') === 's3') {
      // Validate the env contract before selecting it. Credentials intentionally
      // stay in the process environment and are not copied into the DB config.
      s3CompatibleConfigFromEnvironment()

      const providers = await StorageProvider.all()
      let provider = providers.find(
        (candidate) =>
          candidate.config?.driver === 's3' && candidate.config?.configSource === 'environment'
      )

      if (!provider) {
        provider = await StorageProvider.create({
          name: 'S3-compatible Object Storage (.env)',
          type: 'cloud',
          config: { driver: 's3', configSource: 'environment' },
          isDefault: false,
          isActive: true,
          quotaBytes: 10 * 1024 * 1024 * 1024,
        })
      }

      await db.transaction(async (trx) => {
        await trx.from('storage_providers').update({ is_default: false })
        const selectedProvider = await StorageProvider.query({ client: trx })
          .where('id', provider.id)
          .firstOrFail()
        selectedProvider.config = { driver: 's3', configSource: 'environment' }
        selectedProvider.isActive = true
        selectedProvider.isDefault = true
        await selectedProvider.save()
      })
    }
  }
}

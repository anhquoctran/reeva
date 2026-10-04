import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  decryptStorageProviderConfig,
  encryptStorageProviderConfig,
  isEncryptedStorageProviderConfig,
} from '#services/storage/storage_provider_config_crypto'
import { normalizeS3CompatibleConfig } from '#services/storage/s3_compatible_config'
import env from '#start/env'

function parseConfig(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Found an invalid storage provider configuration during encryption migration.')
  }
  return parsed as Record<string, unknown>
}

function migrateEnvironmentProvider() {
  const migrated = normalizeS3CompatibleConfig(
    {
      bucket: env.get('S3_BUCKET'),
      endpoint: env.get('S3_ENDPOINT'),
      region: env.get('S3_REGION'),
      accessKeyId: env.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: env.get('S3_SECRET_ACCESS_KEY'),
      sessionToken: env.get('S3_SESSION_TOKEN'),
      forcePathStyle: env.get('S3_FORCE_PATH_STYLE'),
      maxAttempts: env.get('S3_MAX_ATTEMPTS'),
      connectionTimeoutMs: env.get('S3_CONNECTION_TIMEOUT_MS'),
      socketTimeoutMs: env.get('S3_SOCKET_TIMEOUT_MS'),
      downloadUrlTtlSeconds: env.get('S3_DOWNLOAD_URL_TTL_SECONDS'),
    },
    's3'
  )
  return { driver: 's3', ...migrated }
}

export default class extends BaseSchema {
  async up() {
    this.defer(async (client) => {
      const providers = await client.from('storage_providers').select('id', 'config')
      for (const provider of providers) {
        let config = parseConfig(provider.config)
        if (isEncryptedStorageProviderConfig(config)) continue
        if (config.configSource === 'environment') {
          try {
            config = migrateEnvironmentProvider()
          } catch {
            throw new Error(
              'Cannot migrate the environment-backed S3 provider. Keep its complete legacy S3_* settings available for this startup, then run migrations again.'
            )
          }
        }
        await client
          .from('storage_providers')
          .where('id', provider.id)
          .update({ config: encryptStorageProviderConfig(config) })
      }
    })
  }

  async down() {
    this.defer(async (client) => {
      const providers = await client.from('storage_providers').select('id', 'config')
      for (const provider of providers) {
        const config = parseConfig(provider.config)
        if (!isEncryptedStorageProviderConfig(config)) continue
        await client
          .from('storage_providers')
          .where('id', provider.id)
          .update({ config: decryptStorageProviderConfig(config) })
      }
    })
  }
}

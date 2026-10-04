import type StorageProvider from '#models/storage_provider'
import LocalProvider from './providers/local_provider.js'
import S3CompatibleProvider from './providers/s3_compatible_provider.js'
import { normalizeS3CompatibleConfig } from './s3_compatible_config.js'
import type { BaseStorageProvider } from '#services/storage/base_storage_provider'

const S3_DRIVERS = new Set(['s3', 'minio', 'seaweedfs', 'oci', 'r2'])

function asConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Storage provider configuration must be an object.')
  }
  return value as Record<string, unknown>
}

export default class StorageManager {
  /**
   * Resolves a StorageProvider model instance into a concrete implementation.
   */
  static resolve(provider: StorageProvider): BaseStorageProvider {
    const config = asConfig(provider.config)
    const configuredDriver = config.driver
    const driverName =
      typeof configuredDriver === 'string' && configuredDriver.trim()
        ? configuredDriver.trim().toLowerCase()
        : provider.type.toLowerCase()

    if (driverName === 'local') {
      return new LocalProvider(config)
    }

    if (S3_DRIVERS.has(driverName)) {
      const s3Config = normalizeS3CompatibleConfig(config, driverName)
      return new S3CompatibleProvider(s3Config)
    }

    throw new Error(`Unsupported storage provider driver: ${driverName}`)
  }
}

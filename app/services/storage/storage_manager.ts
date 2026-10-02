import type StorageProvider from '#models/storage_provider'
import LocalProvider from './providers/local_provider.js'
import MinIOProvider from './providers/min_io_provider.js'
import AWSS3Provider from './providers/aws_s3_provider.js'
import SeaweedFSProvider from './providers/seaweed_fs_provider.js'
import type { BaseStorageProvider } from '#services/storage/base_storage_provider'

/**
 * Storage Manager maps provider types to their actual implementations.
 */
const PROVIDER_MAP: Record<string, new (config: unknown) => BaseStorageProvider> = {
  local: LocalProvider,
  minio: MinIOProvider,
  s3: AWSS3Provider,
  seaweedfs: SeaweedFSProvider,
}

export default class StorageManager {
  /**
   * Resolves a StorageProvider model instance into a concrete implementation.
   */
  static resolve(provider: StorageProvider): BaseStorageProvider {
    const driverName = (provider.config as any)?.driver || provider.type
    const ProviderClass = PROVIDER_MAP[driverName]

    if (!ProviderClass) {
      throw new Error(`Unsupported provider: ${provider.type}`)
    }

    return new ProviderClass(provider.config)
  }
}

import StorageProvider from '#models/storage_provider'
import LocalProvider from './providers/LocalProvider.js'
import MinIOProvider from './providers/MinIOProvider.js'
import AWSS3Provider from './providers/AWSS3Provider.js'
import SeaweedFSProvider from './providers/SeaweedFSProvider.js'
import type { BaseStorageProvider } from './BaseStorageProvider.js'

/**
 * Storage Manager maps provider types to their actual implementations.
 */
const PROVIDER_MAP: Record<string, any> = {
  local: LocalProvider,
  minio: MinIOProvider,
  s3: AWSS3Provider,
  seaweedfs: SeaweedFSProvider,
}

export default class StorageManager {
  private static _driver: BaseStorageProvider

  /**
   * Resolves a StorageProvider model instance into a concrete implementation.
   */
  static resolve(provider: StorageProvider) {
    const driverName = (provider.config as any)?.driver || provider.type
    const ProviderClass = PROVIDER_MAP[driverName]

    if (!ProviderClass) {
      throw new Error(`Unsupported provider: ${provider.type}`)
    }

    return new ProviderClass(provider.config)
  }

  /**
   * Boots the storage manager by loading the current active provider from DB
   */
  static async boot() {
    console.log('[StorageManager] Booting active provider...')
    const provider = await StorageProvider.query().where('isDefault', true).first()
    
    if (provider) {
      this._driver = this.resolve(provider)
      console.log(`[StorageManager] Loaded active provider: ${provider.name} (${provider.type})`)
    } else {
      console.warn('[StorageManager] No active storage provider found in database.')
    }
  }

  /**
   * Returns the currently active driver
   */
  static getDriver() {
    if (!this._driver) {
      throw new Error('Storage driver not initialized. Call StorageManager.boot() first.')
    }
    return this._driver
  }
}

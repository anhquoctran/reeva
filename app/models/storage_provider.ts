import { StorageProviderSchema } from '#database/schema'
import { beforeCreate, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'
import {
  decryptStorageProviderConfig,
  encryptStorageProviderConfig,
  isEncryptedStorageProviderConfig,
} from '#services/storage/storage_provider_config_crypto'

export default class StorageProvider extends compose(StorageProviderSchema, SoftDeletes) {
  static selfAssignPrimaryKey = true

  @column({
    serializeAs: null,
    prepare: (value) => {
      let config = value
      if (typeof config === 'string') {
        try {
          config = JSON.parse(config)
        } catch {
          throw new Error('Storage provider config must be a JSON object.')
        }
      }
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Storage provider config must be a JSON object.')
      }
      if (isEncryptedStorageProviderConfig(config)) return JSON.stringify(config)
      return JSON.stringify(encryptStorageProviderConfig(config as Record<string, unknown>))
    },
    consume: (value) => {
      let config = value
      if (typeof config !== 'string') return decryptStorageProviderConfig(config)
      try {
        config = JSON.parse(config)
      } catch {
        throw new Error('Storage provider config in the database is not valid JSON.')
      }
      return decryptStorageProviderConfig(config)
    },
  })
  declare config: Record<string, unknown>

  @column()
  declare isActive: boolean

  @column({ consume: (value) => (value === null ? null : Number(value)) })
  declare quotaBytes: number | null
  @beforeCreate()
  static async generateUuid(storageProvider: StorageProvider) {
    if (!storageProvider.id) {
      storageProvider.id = randomUUID()
    }
  }
}

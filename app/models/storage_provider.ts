import { StorageProviderSchema } from '#database/schema'
import { beforeCreate, column } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class StorageProvider extends StorageProviderSchema {
  @column()
  declare isActive: boolean

  @column()
  declare quotaBytes: number | null
  @beforeCreate()
  static async generateUuid(storageProvider: StorageProvider) {
    if (!storageProvider.id) {
      storageProvider.id = randomUUID()
    }
  }
}
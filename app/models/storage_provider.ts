import { StorageProviderSchema } from '#database/schema'
import { beforeCreate, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'

export default class StorageProvider extends compose(StorageProviderSchema, SoftDeletes) {

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
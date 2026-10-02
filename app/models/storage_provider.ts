import { StorageProviderSchema } from '#database/schema'
import { beforeCreate, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'

export default class StorageProvider extends compose(StorageProviderSchema, SoftDeletes) {
  static selfAssignPrimaryKey = true

  @column({
    prepare: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
    consume: (value) => {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    },
  })
  declare config: Record<string, unknown>

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

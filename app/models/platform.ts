import { PlatformSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { compose } from '@adonisjs/core/helpers'
import { randomUUID } from 'node:crypto'

export default class Platform extends compose(PlatformSchema, SoftDeletes) {

  @beforeCreate()
  static async generateUuid(platform: Platform) {
    if (!platform.id) {
      platform.id = randomUUID()
    }
  }
}
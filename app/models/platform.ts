import { PlatformSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class Platform extends PlatformSchema {
  @beforeCreate()
  static async generateUuid(platform: Platform) {
    if (!platform.id) {
      platform.id = randomUUID()
    }
  }
}
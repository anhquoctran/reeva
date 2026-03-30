import { VersionSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class Version extends VersionSchema {
  @beforeCreate()
  static async generateUuid(version: Version) {
    if (!version.id) {
      version.id = randomUUID()
    }
  }
}
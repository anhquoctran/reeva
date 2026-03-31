import { VersionSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'

export default class Version extends compose(VersionSchema, SoftDeletes) {

  @beforeCreate()
  static async generateUuid(version: Version) {
    if (!version.id) {
      version.id = randomUUID()
    }
  }
}
import { ArchitectureSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { compose } from '@adonisjs/core/helpers'
import { randomUUID } from 'node:crypto'

export default class Architecture extends compose(ArchitectureSchema, SoftDeletes) {

  @beforeCreate()
  static async generateUuid(architecture: Architecture) {
    if (!architecture.id) {
      architecture.id = randomUUID()
    }
  }
}
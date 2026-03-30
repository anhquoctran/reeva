import { ArchitectureSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class Architecture extends ArchitectureSchema {
  @beforeCreate()
  static async generateUuid(architecture: Architecture) {
    if (!architecture.id) {
      architecture.id = randomUUID()
    }
  }
}
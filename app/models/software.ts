import { SoftwareSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class Software extends SoftwareSchema {
  static selfAssignPrimaryKey = true
  static table = 'software'

  @beforeCreate()
  static generateUuid(software: Software) {
    if (!software.id) software.id = randomUUID()
  }
}

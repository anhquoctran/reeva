import { SoftwareSchema } from '#database/schema'
import { beforeCreate, hasMany } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import SoftwareSigningKey from '#models/software_signing_key'

export default class Software extends SoftwareSchema {
  static selfAssignPrimaryKey = true
  static table = 'software'

  @hasMany(() => SoftwareSigningKey)
  declare signingKeys: HasMany<typeof SoftwareSigningKey>

  @beforeCreate()
  static generateUuid(software: Software) {
    if (!software.id) software.id = randomUUID()
  }
}

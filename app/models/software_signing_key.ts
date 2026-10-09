import { beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'
import { SoftwareSigningKeySchema } from '#database/schema'
import Software from '#models/software'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class SoftwareSigningKey extends SoftwareSigningKeySchema {
  static selfAssignPrimaryKey = true
  static table = 'software_signing_keys'

  @belongsTo(() => Software)
  declare software: BelongsTo<typeof Software>

  @beforeCreate()
  static generateUuid(key: SoftwareSigningKey) {
    if (!key.id) key.id = randomUUID()
  }
}

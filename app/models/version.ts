import { VersionSchema } from '#database/schema'
import { beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Software from '#models/software'

export default class Version extends compose(VersionSchema, SoftDeletes) {
  static selfAssignPrimaryKey = true

  @belongsTo(() => Software)
  declare software: BelongsTo<typeof Software>

  @beforeCreate()
  static async generateUuid(version: Version) {
    if (!version.id) {
      version.id = randomUUID()
    }
  }
}

import { LicenseActivationSchema } from '#database/schema'
import { beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import License from '#models/license'

export default class LicenseActivation extends LicenseActivationSchema {
  @belongsTo(() => License)
  declare license: BelongsTo<typeof License>

  @beforeCreate()
  static async generateUuid(activation: LicenseActivation) {
    if (!activation.id) {
      activation.id = randomUUID()
    }
  }
}

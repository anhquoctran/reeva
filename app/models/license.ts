import { LicenseSchema } from '#database/schema'
import { beforeCreate, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'
import type { default as LicenseActivation } from '#models/license_activation'

export default class License extends compose(LicenseSchema, SoftDeletes) {
  @hasMany(() => import('#models/license_activation'))
  declare activations: HasMany<typeof LicenseActivation>

  @beforeCreate()
  static async generateUuid(license: License) {
    if (!license.id) {
      license.id = randomUUID()
    }
  }

  @beforeCreate()
  static async generateLicenseKey(license: License) {
    if (!license.licenseKey) {
      // Format: REEVA-XXXX-XXXX-XXXX
      const part1 = randomUUID().substring(0, 4).toUpperCase()
      const part2 = randomUUID().substring(0, 4).toUpperCase()
      const part3 = randomUUID().substring(0, 4).toUpperCase()
      license.licenseKey = `REEVA-${part1}-${part2}-${part3}`
    }
  }
}
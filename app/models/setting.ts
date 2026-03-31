import { SettingSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'

export default class Setting extends compose(SettingSchema, SoftDeletes) {

  @beforeCreate()
  static async generateUuid(setting: Setting) {
    if (!setting.id) {
      setting.id = randomUUID()
    }
  }
}
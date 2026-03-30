import { SettingSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'

export default class Setting extends SettingSchema {
  @beforeCreate()
  static async generateUuid(setting: Setting) {
    if (!setting.id) {
      setting.id = randomUUID()
    }
  }
}
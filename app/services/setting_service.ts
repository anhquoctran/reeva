import { inject } from '@adonisjs/core'
import SettingRepository from '#repositories/setting_repository'

@inject()
export default class SettingService {
  constructor(protected settingRepository: SettingRepository) {}

  async getAllSettings() {
    return await this.settingRepository.query().whereNot('key', 'appName').orderBy('key', 'asc')
  }

  async createSetting(key: string, value: string) {
    this.validate(key, value)
    if (key === 'appName') throw new Error('Manage software product names from Software settings.')
    const existing = await this.settingRepository.findByKey(key)
    if (existing) {
      throw new Error(`Setting key "${key}" already exists.`)
    }

    const settingModule = await import('#models/setting')
    const Setting = settingModule.default
    return await Setting.create({ key, value })
  }

  async updateSetting(id: string | number, value: string) {
    if (typeof value !== 'string' || value.length > 2000) {
      throw new Error('Setting value must be text and 2,000 characters or fewer.')
    }
    const settingModule = await import('#models/setting')
    const Setting = settingModule.default
    const setting = await Setting.findOrFail(id)
    if (setting.key === 'appName') {
      throw new Error('Manage software product names from Software settings.')
    }
    setting.value = value
    await setting.save()
    return setting
  }

  async deleteSetting(id: string | number) {
    const settingModule = await import('#models/setting')
    const Setting = settingModule.default
    const setting = await Setting.findOrFail(id)
    if (setting.key === 'appName') {
      throw new Error('The legacy appName setting is retained for migration history.')
    }
    await setting.delete()
    return setting
  }

  private validate(key: string, value: string) {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,99}$/.test(key)) {
      throw new Error(
        'Setting key must start with a letter and contain at most 100 safe characters.'
      )
    }
    if (typeof value !== 'string' || value.length > 2000) {
      throw new Error('Setting value must be text and 2,000 characters or fewer.')
    }
  }
}

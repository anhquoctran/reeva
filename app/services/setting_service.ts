import { inject } from '@adonisjs/core'
import SettingRepository from '#repositories/setting_repository'

@inject()
export default class SettingService {
  constructor(protected settingRepository: SettingRepository) {}

  async getAllSettings() {
    return await this.settingRepository.query().orderBy('key', 'asc')
  }

  async createSetting(key: string, value: string) {
    const existing = await this.settingRepository.findByKey(key)
    if (existing) {
      throw new Error(`Setting key "${key}" already exists.`)
    }

    const Setting = (await import('#models/setting')).default
    return await Setting.create({ key, value })
  }

  async updateSetting(id: string | number, value: string) {
    const Setting = (await import('#models/setting')).default
    const setting = await Setting.findOrFail(id)
    setting.value = value
    await setting.save()
    return setting
  }

  async deleteSetting(id: string | number) {
    const Setting = (await import('#models/setting')).default
    const setting = await Setting.findOrFail(id)
    await setting.delete()
    return setting
  }
}

import Setting from '#models/setting'

export default class SettingRepository {
  query() {
    return Setting.query()
  }

  async findByKey(key: string) {
    return await Setting.findBy('key', key)
  }
}

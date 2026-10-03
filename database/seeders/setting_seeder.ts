import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Setting from '#models/setting'

export default class extends BaseSeeder {
  async run() {
    await Setting.firstOrCreate(
      { key: 'uploadLimitSize' },
      { key: 'uploadLimitSize', value: '1GB' }
    )
  }
}

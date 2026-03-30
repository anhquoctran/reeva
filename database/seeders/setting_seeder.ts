import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Setting from '#models/setting'

export default class extends BaseSeeder {
  async run() {
    await Setting.updateOrCreate(
      { key: 'appName' },
      { value: 'reeva' }
    )
  }
}
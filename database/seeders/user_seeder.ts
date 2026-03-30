import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
  async run() {
    await User.updateOrCreate(
      { email: 'admin@reeva.io' },
      {
        email: 'admin@reeva.io',
        passwordHash: 'secret',
        isRoot: true,
      }
    )
  }
}
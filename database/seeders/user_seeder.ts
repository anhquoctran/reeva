import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import env from '#start/env'

export default class extends BaseSeeder {
  async run() {
    const email = env.get('ADMIN_EMAIL')?.trim().toLowerCase()
    const password = env.get('ADMIN_PASSWORD')
    if (!email || !password || password.length < 16) {
      throw new Error(
        'Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters before seeding users.'
      )
    }

    const user = await User.firstOrCreate(
      { email },
      // AuthFinder hashes this mapped password column when the model is saved.
      { email, passwordHash: password, isRoot: true, isActive: true }
    )
    if (!user.isRoot || user.passwordHash === 'admin') {
      user.isRoot = true
      if (user.passwordHash === 'admin') user.passwordHash = password
      await user.save()
    }
  }
}

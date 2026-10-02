import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
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
      { email, passwordHash: await hash.make(password), isRoot: true, isActive: true }
    )
    if (!user.isRoot || user.passwordHash === 'admin') {
      user.isRoot = true
      if (user.passwordHash === 'admin') user.passwordHash = await hash.make(password)
      await user.save()
    }
  }
}

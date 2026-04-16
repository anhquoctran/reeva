
import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'

export default async function run() {
  try {
    const u = await User.first()
    if (u) {
      console.log('isActive value:', u.isActive, 'type:', typeof u.isActive)
      console.log('!isActive:', !u.isActive)
    }
  } catch(e) {
    console.error('Error:', e)
  }
}


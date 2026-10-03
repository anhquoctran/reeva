import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'
import hash from '@adonisjs/core/services/hash'
import { randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class UserService {
  constructor(protected userRepository: UserRepository) {}

  async paginateUsers(page: number, limit: number) {
    return await this.userRepository.paginate(page, limit)
  }

  async createUser(email: string, fullName: string | null) {
    if (
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 255
    ) {
      throw new Error('Please enter a valid email address.')
    }
    if (fullName !== null && (typeof fullName !== 'string' || fullName.length > 255)) {
      throw new Error('Name must be 255 characters or fewer.')
    }
    email = email.trim().toLowerCase()

    const existing = await this.userRepository.findByEmail(email)
    if (existing) {
      throw new Error('A user with this email already exists.')
    }

    const randomPassword = randomBytes(24).toString('hex')

    await this.userRepository.create({
      email,
      fullName: fullName,
      // AuthFinder's model hook hashes this mapped password column on save.
      passwordHash: randomPassword,
    })

    return { email, randomPassword }
  }

  async getUser(id: string | number) {
    return await this.userRepository.findById(id)
  }

  async updateUser(id: string | number, fullName: string | null) {
    if (fullName !== null && (typeof fullName !== 'string' || fullName.length > 255)) {
      throw new Error('Name must be 255 characters or fewer.')
    }
    const user = await this.userRepository.findById(id)
    user.merge({ fullName })
    return await this.userRepository.update(user)
  }

  async resetPassword(id: string | number, currentUserId: number | string) {
    const user = await this.userRepository.findById(id)
    if (user.id === currentUserId) {
      throw new Error('You cannot reset your own password from here. Use your Profile page.')
    }
    if (user.isRoot) {
      throw new Error('Root user password cannot be reset from here.')
    }

    const newPassword = randomBytes(8).toString('hex')
    user.passwordHash = newPassword
    user.authVersion++
    await db.transaction(async (trx) => {
      await user.useTransaction(trx).save()
      await trx.from('remember_me_tokens').where('tokenable_id', user.id).delete()
      await trx.from('password_reset_tokens').where('email', user.email).delete()
    })

    return { email: user.email, newPassword }
  }

  async toggleActiveUser(id: string | number, currentUserId: number | string) {
    const user = await this.userRepository.findById(id)
    if (user.isRoot) {
      throw new Error('Root user cannot be disabled/enabled.')
    }
    if (user.id === currentUserId) {
      throw new Error('You cannot toggle your own active status.')
    }

    user.isActive = !user.isActive
    user.authVersion++
    await this.userRepository.update(user)
    return { email: user.email, isActive: user.isActive }
  }

  async updateProfile(id: string | number, fullName: string | null) {
    if (fullName !== null && (typeof fullName !== 'string' || fullName.length > 255)) {
      throw new Error('Name must be 255 characters or fewer.')
    }
    const user = await this.userRepository.findById(id)
    user.merge({ fullName })
    return await this.userRepository.update(user)
  }

  async changePassword(id: string | number, currentPassword: string, newPassword: string) {
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
      throw new Error('New password must be between 12 and 128 characters.')
    }

    const user = await this.userRepository.findById(id)

    // 1. Check current password
    const isMatched = await hash.verify(user.passwordHash, currentPassword)
    if (!isMatched) {
      throw new Error('Current password is incorrect.')
    }

    // 2. Update to new password
    user.passwordHash = newPassword
    user.authVersion++
    await db.transaction(async (trx) => {
      await user.useTransaction(trx).save()
      await trx.from('remember_me_tokens').where('tokenable_id', user.id).delete()
      await trx.from('password_reset_tokens').where('email', user.email).delete()
    })
    return user
  }

  async updateAppearance(id: string | number, theme: string, accentColor: number) {
    const user = await this.userRepository.findById(id)
    const validThemes = ['light', 'dark', 'system']
    if (!validThemes.includes(theme)) throw new Error('Unsupported appearance theme.')
    if (!Number.isInteger(accentColor) || accentColor < 0 || accentColor > 6) {
      throw new Error('Unsupported accent color.')
    }
    user.theme = theme
    user.accentColor = accentColor
    return await this.userRepository.update(user)
  }
}

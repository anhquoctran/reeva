import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'
import hash from '@adonisjs/core/services/hash'
import { randomBytes } from 'node:crypto'

@inject()
export default class UserService {
  constructor(protected userRepository: UserRepository) {}

  async paginateUsers(page: number, limit: number) {
    return await this.userRepository.paginate(page, limit)
  }

  async createUser(email: string, fullName: string | null) {
    const existing = await this.userRepository.findByEmail(email)
    if (existing) {
      throw new Error('A user with this email already exists.')
    }

    const randomPassword = randomBytes(8).toString('hex')
    const hashedPassword = await hash.make(randomPassword)

    await this.userRepository.create({
      email,
      fullName: fullName,
      passwordHash: hashedPassword,
    })

    return { email, randomPassword }
  }

  async getUser(id: string | number) {
    return await this.userRepository.findById(id)
  }

  async updateUser(id: string | number, fullName: string | null) {
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
    const hashedPassword = await hash.make(newPassword)
    
    // Explicitly bypass ORM dirty tracking using direct query builder
    const db = await import('@adonisjs/lucid/services/db')
    await db.default.from('users').where('id', id).update({ password_hash: hashedPassword })

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

    const newStatus = !user.isActive
    const db = await import('@adonisjs/lucid/services/db')
    await db.default.from('users').where('id', id).update({ is_active: newStatus })
    
    return { email: user.email, isActive: newStatus }
  }

  async updateProfile(id: string | number, fullName: string | null) {
    const user = await this.userRepository.findById(id)
    user.merge({ fullName })
    return await this.userRepository.update(user)
  }

  async changePassword(id: string | number, currentPassword: string, newPassword: string) {
    const user = await this.userRepository.findById(id)
    
    // 1. Check current password
    const isMatched = await hash.verify(user.passwordHash, currentPassword)
    if (!isMatched) {
      throw new Error('Current password is incorrect.')
    }

    // 2. Update to new password
    const hashedPassword = await hash.make(newPassword)
    
    const db = await import('@adonisjs/lucid/services/db')
    await db.default.from('users').where('id', id).update({ password_hash: hashedPassword })
    
    return user
  }
}

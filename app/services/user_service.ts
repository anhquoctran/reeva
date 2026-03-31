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
    user.fullName = fullName
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
    user.passwordHash = await hash.make(newPassword)
    await this.userRepository.update(user)

    return { email: user.email, newPassword }
  }

  async deleteUser(id: string | number, currentUserId: number | string) {
    const user = await this.userRepository.findById(id)
    if (user.isRoot) {
      throw new Error('Root user cannot be deleted.')
    }
    if (user.id === currentUserId) {
      throw new Error('You cannot delete your own account.')
    }

    await this.userRepository.delete(user)
    return user.email
  }

  async updateProfile(id: string | number, fullName: string | null) {
    const user = await this.userRepository.findById(id)
    user.fullName = fullName
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
    user.passwordHash = await hash.make(newPassword)
    return await this.userRepository.update(user)
  }
}

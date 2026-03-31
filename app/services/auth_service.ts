import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'
import mail from '@adonisjs/mail/services/main'
import ForgotPasswordNotification from '#mails/forgot_password_notification'
import { randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'

@inject()
export default class AuthService {
  constructor(protected userRepository: UserRepository) {}

  async sendPasswordResetLink(email: string) {
    const user = await this.userRepository.findByEmail(email)

    if (user) {
      const token = randomBytes(32).toString('hex')

      await db.table('password_reset_tokens').insert({
        email: user.email,
        token: token,
        expires_at: DateTime.now().plus({ hours: 1 }).toFormat('yyyy-MM-dd HH:mm:ss'),
        created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
      })

      await mail.send(new ForgotPasswordNotification(user, token))
    }
  }

  async verifyResetToken(token: string) {
    return await db
      .from('password_reset_tokens')
      .where('token', token)
      .where('expires_at', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
      .first()
  }

  async updatePasswordByToken(token: string, password: string) {
    const tokenData = await this.verifyResetToken(token)

    if (!tokenData) {
      throw new Error('Invalid token or expired.')
    }

    const User = (await import('#models/user')).default
    const user = await User.findByOrFail('email', tokenData.email)
    user.passwordHash = await hash.make(password)
    await user.save()

    await db.from('password_reset_tokens').where('email', tokenData.email).delete()

    return user
  }
}

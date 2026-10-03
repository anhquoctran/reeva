import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'
import mail from '@adonisjs/mail/services/main'
import ForgotPasswordNotification from '#mails/forgot_password_notification'
import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

@inject()
export default class AuthService {
  constructor(protected userRepository: UserRepository) {}

  async sendPasswordResetLink(email: string) {
    const user = await this.userRepository.findByEmail(email.trim())

    if (user?.isActive) {
      const token = randomBytes(32).toString('hex')
      const now = DateTime.utc()

      await db.transaction(async (trx) => {
        await trx.from('password_reset_tokens').where('email', user.email).delete()
        await trx.table('password_reset_tokens').insert({
          email: user.email,
          token: this.hashResetToken(token),
          expires_at: now.plus({ hours: 1 }).toJSDate(),
          created_at: now.toJSDate(),
        })
      })

      await mail.send(new ForgotPasswordNotification(user, token))
    }
  }

  async verifyResetToken(token: string) {
    const now = DateTime.utc().toJSDate()
    const hashed = await db
      .from('password_reset_tokens')
      .where('token', this.hashResetToken(token))
      .where('expires_at', '>', now)
      .first()

    if (hashed) return hashed

    // Keep outstanding plaintext links created by older versions valid until
    // their existing one-hour expiry; successful use upgrades them atomically.
    return db
      .from('password_reset_tokens')
      .where('token', token)
      .where('expires_at', '>', now)
      .first()
  }

  async updatePasswordByToken(token: string, password: string) {
    const userModule = await import('#models/user')
    const User = userModule.default
    const now = DateTime.utc().toJSDate()
    const hashedToken = this.hashResetToken(token)

    return db.transaction(async (trx) => {
      let tokenData = await trx
        .from('password_reset_tokens')
        .where('token', hashedToken)
        .where('expires_at', '>', now)
        .forUpdate()
        .first()

      if (!tokenData) {
        tokenData = await trx
          .from('password_reset_tokens')
          .where('token', token)
          .where('expires_at', '>', now)
          .forUpdate()
          .first()
      }

      if (!tokenData) throw new Error('Invalid token or expired.')

      const consumed = await trx.from('password_reset_tokens').where('id', tokenData.id).delete()
      if (Number(consumed) !== 1) throw new Error('Invalid token or expired.')

      const user = await User.query({ client: trx }).where('email', tokenData.email).firstOrFail()
      if (!user.isActive) throw new Error('Invalid token or expired.')
      // AuthFinder hashes the mapped password column in its model save hook.
      user.passwordHash = password
      user.authVersion++
      await user.useTransaction(trx).save()

      await trx.from('password_reset_tokens').where('email', user.email).delete()
      await trx.from('remember_me_tokens').where('tokenable_id', user.id).delete()
      return user
    })
  }

  async isAuthRequestThrottled(
    action: 'login' | 'password-reset',
    ipAddress: string,
    identity: string
  ) {
    const normalizedIdentity = identity.trim().toLowerCase()
    const ipLimit = action === 'login' ? 30 : 20
    const identityLimit = action === 'login' ? 8 : 5
    const keys = [
      this.rateLimitKey(action, 'ip', ipAddress),
      this.rateLimitKey(action, 'identity', normalizedIdentity || 'missing'),
    ]
    const now = DateTime.utc()
    const windowEnd = now.plus({ minutes: 1 })

    const incrementCounter = async (key: string) => {
      const [row] = await db
        .table('auth_rate_limits')
        .insert({ key, attempts: 1, window_ends_at: windowEnd.toJSDate() })
        .onConflict('key')
        .merge({
          attempts: db.raw(
            'CASE WHEN auth_rate_limits.window_ends_at <= ? THEN 1 ELSE auth_rate_limits.attempts + 1 END',
            [now.toJSDate()]
          ),
          window_ends_at: db.raw(
            'CASE WHEN auth_rate_limits.window_ends_at <= ? THEN ? ELSE auth_rate_limits.window_ends_at END',
            [now.toJSDate(), windowEnd.toJSDate()]
          ),
        })
        .returning('attempts')
      return Number(row?.attempts || 0)
    }

    const ipAttempts = await incrementCounter(keys[0])
    if (ipAttempts > ipLimit) {
      await db.from('auth_rate_limits').where('window_ends_at', '<=', now.toJSDate()).delete()
      return true
    }

    const identityAttempts = await incrementCounter(keys[1])

    // Opportunistically bound old key retention without a separate worker.
    await db.from('auth_rate_limits').where('window_ends_at', '<=', now.toJSDate()).delete()
    return identityAttempts > identityLimit
  }

  async clearLoginAttempts(ipAddress: string, identity: string) {
    const keys = [
      this.rateLimitKey('login', 'ip', ipAddress),
      this.rateLimitKey('login', 'identity', identity.trim().toLowerCase() || 'missing'),
    ]
    await db.from('auth_rate_limits').whereIn('key', keys).delete()
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private rateLimitKey(action: string, subject: string, value: string) {
    return createHash('sha256').update(`${action}:${subject}:${value}`).digest('hex')
  }
}

import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbRememberMeTokensProvider } from '@adonisjs/auth/session'
import { beforeCreate, column } from '@adonisjs/lucid/orm'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { randomUUID } from 'node:crypto'

/**
 * Configure AuthFinder with actual column names from DDL
 */
const AuthFinder = withAuthFinder(hash, {
  uids: ['email'],
  passwordColumnName: 'passwordHash',
})

/**
 * User model represents a user in the application.
 * It extends UserSchema and includes authentication capabilities
 * through the withAuthFinder mixin.
 */
export default class User extends compose(UserSchema, AuthFinder, SoftDeletes) {
  static rememberMeTokens = DbRememberMeTokensProvider.forModel(User)

  declare password?: string

  @beforeCreate()
  static async generateUuid(user: User) {
    if (!user.id) {
      user.id = randomUUID()
    }
  }

  @column()
  declare fullName: string | null


  get initials() {
    if (this.fullName) {
      const parts = this.fullName.split(' ')
      const first = parts[0]
      const second = parts.length > 1 ? parts[parts.length - 1] : first.slice(1, 2)
      return `${first.charAt(0)}${second ? second.charAt(0) : ''}`.toUpperCase()
    }
    const [first, ...rest] = this.email.split('@')[0].split(/[._-]/)
    const second = rest.length > 0 ? rest[0] : first.slice(1, 2)
    return `${first.charAt(0)}${second ? second.charAt(0) : ''}`.toUpperCase()
  }
}

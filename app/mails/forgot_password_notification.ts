import { BaseMail } from '@adonisjs/mail'
import type User from '#models/user'

export default class ForgotPasswordNotification extends BaseMail {
  constructor(private user: User, private token: string) {
    super()
  }

  prepare() {
    this.message
      .to(this.user.email)
      .subject('Reset your Reeva Password')
      .htmlView('emails/forgot_password', {
        user: this.user,
        url: `${process.env.APP_URL}/forgot-password/${this.token}`
      })
  }
}
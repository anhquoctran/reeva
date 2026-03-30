import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import ForgotPasswordNotification from '#mails/forgot_password_notification'
import { randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/**
 * SessionController handles user authentication and session management.
 * It provides methods for displaying the login page, authenticating users,
 * and logging out.
 */
export default class SessionController {
  /**
   * Display the login page
   */
  async create({ view }: HttpContext) {
    return view.render('pages/auth/login')
  }

  /**
   * Authenticate user credentials and create a new session
   */
  async store({ request, auth, response }: HttpContext) {
    const { email, password } = request.all()
    const user = await User.verifyCredentials(email, password)
    const rememberMe = !!request.input('remember_me')

    await auth.use('web').login(user, rememberMe)
    return response.redirect().toRoute('cms.dashboard')
  }

  /**
   * Log out the current user and destroy their session
   */
  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.redirect().toRoute('session.create')
  }

  /**
   * Display the forgot password page
   */
  async forgotPassword({ view }: HttpContext) {
    return view.render('pages/auth/forgot_password')
  }

  /**
   * Handle the password reset request
   */
  async sendResetLink({ request, session, response }: HttpContext) {
    const email = request.input('email')
    const user = await User.findBy('email', email)

    if (user) {
      // 1. Generate token
      const token = randomBytes(32).toString('hex')
      
      // 2. Save token to DB
      await db.table('password_reset_tokens').insert({
        email: user.email,
        token: token,
        expires_at: DateTime.now().plus({ hours: 1 }).toFormat('yyyy-MM-dd HH:mm:ss'),
        created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
      })

      // 3. Send Email
      await mail.send(new ForgotPasswordNotification(user, token))
    }

    // Always show success message for security
    session.flash('success', 'If an account exists with that email, a reset link has been sent.')
    return response.redirect().back()
  }

  /**
   * Show the reset password page if token is valid
   */
  async resetPassword({ params, view, response, session }: HttpContext) {
    const token = await db
      .from('password_reset_tokens')
      .where('token', params.token)
      .where('expires_at', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
      .first()

    if (!token) {
      session.flash('error', 'The reset link is invalid or has expired.')
      return response.redirect().toRoute('session.forgot_password')
    }

    return view.render('pages/auth/reset_password', { token: params.token })
  }

  /**
   * Update the user's password
   */
  async updatePassword({ request, response, session }: HttpContext) {
    const { token, password, password_confirmation } = request.all()

    if (password !== password_confirmation) {
      session.flash('error', 'Passwords do not match.')
      return response.redirect().back()
    }

    // 1. Verify token
    const tokenData = await db
      .from('password_reset_tokens')
      .where('token', token)
      .where('expires_at', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
      .first()

    if (!tokenData) {
      session.flash('error', 'Invalid token or expired.')
      return response.redirect().toRoute('session.forgot_password')
    }

    // 2. Update user
    const user = await User.findByOrFail('email', tokenData.email)
    user.password = password
    await user.save()

    // 3. Delete token
    await db.from('password_reset_tokens').where('email', tokenData.email).delete()

    session.flash('success', 'Your password has been reset successfully. Please login.')
    return response.redirect().toRoute('session.create')
  }
}

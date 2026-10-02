import User from '#models/user'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import AuthService from '#services/auth_service'
import { errors } from '@adonisjs/auth'
import logger from '@adonisjs/core/services/logger'

/**
 * SessionController handles user authentication and session management.
 */
@inject()
export default class SessionController {
  constructor(protected authService: AuthService) {}

  /** Display the login page */
  async create({ view }: HttpContext) {
    return view.render('pages/auth/login')
  }

  /** Authenticate user credentials and create a new session */
  async store({ request, auth, response, session, incomingIp }: HttpContext) {
    const email = request.input('email')
    const password = request.input('password')
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.length > 255 ||
      password.length > 1024
    ) {
      session.flash('error', 'Invalid email or password.')
      return response.redirect().back()
    }

    if (await this.authService.isAuthRequestThrottled('login', incomingIp, email)) {
      session.flash('error', 'Too many attempts. Try again in one minute.')
      return response.status(429).redirect().back()
    }

    let user: User
    try {
      user = await User.verifyCredentials(email.trim(), password)
    } catch (error) {
      if (error instanceof errors.E_INVALID_CREDENTIALS) {
        session.flash('error', 'Invalid email or password.')
        return response.redirect().back()
      }
      throw error
    }

    if (!user.isActive) {
      session.flash('error', 'Invalid email or password.')
      return response.redirect().back()
    }

    const rememberValue = request.input('remember_me')
    const rememberMe = rememberValue === 'on' || rememberValue === true

    await auth.use('web').login(user, rememberMe)
    session.put('authVersion', user.authVersion)
    await this.authService.clearLoginAttempts(incomingIp, email)
    return response.redirect().toRoute('cms.dashboard')
  }

  /** Log out the current user and destroy their session */
  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.redirect().toRoute('session.create')
  }

  /** Display the forgot password page */
  async forgotPassword({ view }: HttpContext) {
    return view.render('pages/auth/forgot_password')
  }

  /** Handle the password reset request */
  async sendResetLink({ request, session, response, incomingIp }: HttpContext) {
    const email = request.input('email')
    const identity = typeof email === 'string' ? email : ''

    if (await this.authService.isAuthRequestThrottled('password-reset', incomingIp, identity)) {
      session.flash('success', 'If an account exists with that email, a reset link has been sent.')
      return response.status(429).redirect().back()
    }

    if (
      typeof email === 'string' &&
      email.length <= 255 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      await this.authService.sendPasswordResetLink(email)
    }

    // Always show success message for security
    session.flash('success', 'If an account exists with that email, a reset link has been sent.')
    return response.redirect().back()
  }

  /** Show the reset password page if token is valid */
  async resetPassword({ params, view, response, session }: HttpContext) {
    if (typeof params.token !== 'string' || !/^[0-9a-f]{64}$/i.test(params.token)) {
      session.flash('error', 'The reset link is invalid or has expired.')
      return response.redirect().toRoute('session.forgot_password')
    }

    const token = await this.authService.verifyResetToken(params.token)

    if (!token) {
      session.flash('error', 'The reset link is invalid or has expired.')
      return response.redirect().toRoute('session.forgot_password')
    }

    return view.render('pages/auth/reset_password', { token: params.token })
  }

  /** Update the user's password */
  async updatePassword({ request, response, session, incomingIp }: HttpContext) {
    const token = request.input('token')
    const password = request.input('password')
    const passwordConfirmation = request.input('password_confirmation')

    if (
      typeof token !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(token) ||
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 128
    ) {
      session.flash('error', 'Use a valid reset link and a password between 12 and 128 characters.')
      return response.redirect().back()
    }

    if (password !== passwordConfirmation) {
      session.flash('error', 'Passwords do not match.')
      return response.redirect().back()
    }

    if (await this.authService.isAuthRequestThrottled('password-reset', incomingIp, token)) {
      session.flash('error', 'Too many attempts. Try again in one minute.')
      return response.status(429).redirect().back()
    }

    try {
      await this.authService.updatePasswordByToken(token, password)
      session.flash('success', 'Your password has been reset successfully. Please login.')
      return response.redirect().toRoute('session.create')
    } catch (error) {
      logger.warn({ err: error }, 'Password reset failed')
      session.flash('error', 'The reset link is invalid or has expired.')
      return response.redirect().toRoute('session.forgot_password')
    }
  }
}

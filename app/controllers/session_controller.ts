import User from '#models/user'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import AuthService from '#services/auth_service'

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
  async store({ request, auth, response }: HttpContext) {
    const { email, password } = request.all()
    const user = await User.verifyCredentials(email, password)
    const rememberMe = !!request.input('remember_me')

    await auth.use('web').login(user, rememberMe)
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
  async sendResetLink({ request, session, response }: HttpContext) {
    const email = request.input('email')

    await this.authService.sendPasswordResetLink(email)

    // Always show success message for security
    session.flash('success', 'If an account exists with that email, a reset link has been sent.')
    return response.redirect().back()
  }

  /** Show the reset password page if token is valid */
  async resetPassword({ params, view, response, session }: HttpContext) {
    const token = await this.authService.verifyResetToken(params.token)

    if (!token) {
      session.flash('error', 'The reset link is invalid or has expired.')
      return response.redirect().toRoute('session.forgot_password')
    }

    return view.render('pages/auth/reset_password', { token: params.token })
  }

  /** Update the user's password */
  async updatePassword({ request, response, session }: HttpContext) {
    const { token, password, password_confirmation } = request.all()

    if (password !== password_confirmation) {
      session.flash('error', 'Passwords do not match.')
      return response.redirect().back()
    }

    try {
      await this.authService.updatePasswordByToken(token, password)
      session.flash('success', 'Your password has been reset successfully. Please login.')
      return response.redirect().toRoute('session.create')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().toRoute('session.forgot_password')
    }
  }
}

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import UserService from '#services/user_service'
import { parsePage } from '#services/pagination'

@inject()
export default class UsersController {
  constructor(protected userService: UserService) {}

  async index({ request, response, view }: HttpContext) {
    const page = parsePage(request.input('page'))
    if (!page) return response.status(400).send('Invalid page.')
    const limit = 10
    const users = await this.userService.paginateUsers(page, limit)
    users.baseUrl(request.url())

    return view.render('pages/cms/users/index', { users })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/users/create')
  }

  async store({ request, session, response }: HttpContext) {
    const email = request.input('email')
    const fullName = request.input('full_name')

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (typeof email !== 'string' || email.length > 255 || !emailRegex.test(email)) {
      session.flash('error', 'Please enter a valid email address.')
      return response.redirect().back()
    }

    try {
      const { randomPassword } = await this.userService.createUser(
        email,
        typeof fullName === 'string' ? fullName.trim() || null : null
      )

      session.flash('success', 'User created successfully.')
      session.flash('tempPassword', randomPassword)
      session.flash('tempEmail', email)
      return response.redirect().toRoute('cms.users.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async edit({ params, view }: HttpContext) {
    const user = await this.userService.getUser(params.id)
    return view.render('pages/cms/users/edit', { editUser: user })
  }

  async update({ params, request, session, response }: HttpContext) {
    const fullName = request.input('full_name')
    if (fullName !== undefined && typeof fullName !== 'string') {
      session.flash('error', 'Name must be text.')
      return response.redirect().back()
    }
    const user = await this.userService.updateUser(
      params.id,
      typeof fullName === 'string' ? fullName.trim() || null : null
    )

    session.flash('success', `User "${user.email}" updated successfully.`)
    return response.redirect().toRoute('cms.users.index')
  }

  async resetPassword({ params, auth, session, response }: HttpContext) {
    const currentUser = auth.user!

    try {
      const { email, newPassword } = await this.userService.resetPassword(params.id, currentUser.id)

      session.flash('success', 'Password reset successfully.')
      session.flash('tempPassword', newPassword)
      session.flash('tempEmail', email)
      return response.redirect().toRoute('cms.users.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async toggleActive({ params, auth, session, response }: HttpContext) {
    const currentUser = auth.user!

    try {
      const { email, isActive } = await this.userService.toggleActiveUser(params.id, currentUser.id)
      session.flash('success', `User "${email}" has been ${isActive ? 'enabled' : 'disabled'}.`)
      return response.redirect().toRoute('cms.users.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }
}

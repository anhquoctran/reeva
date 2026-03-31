import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import UserService from '#services/user_service'

@inject()
export default class UsersController {
  constructor(protected userService: UserService) {}

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    const users = await this.userService.paginateUsers(page, limit)
    users.baseUrl(request.url())

    return view.render('pages/cms/users/index', { users })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/users/create')
  }

  async store({ request, session, response }: HttpContext) {
    const { email, full_name } = request.all()

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      session.flash('error', 'Please enter a valid email address.')
      return response.redirect().back()
    }

    try {
      const { randomPassword } = await this.userService.createUser(email, full_name || null)
      
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
    const { full_name } = request.all()
    const user = await this.userService.updateUser(params.id, full_name || null)

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

  async destroy({ params, auth, session, response }: HttpContext) {
    const currentUser = auth.user!

    try {
      const email = await this.userService.deleteUser(params.id, currentUser.id)
      session.flash('success', `User "${email}" has been deleted.`)
      return response.redirect().toRoute('cms.users.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }
}

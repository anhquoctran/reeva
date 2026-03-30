import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'

export default class UsersController {
  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    const users = await User.query().orderBy('createdAt', 'asc').paginate(page, limit)
    users.baseUrl(request.url())

    return view.render('pages/cms/users/index', { users })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/users/create')
  }

  async store({ request, session, response }: HttpContext) {
    const { email, full_name } = request.all()

    // Check if email already exists
    const existing = await User.findBy('email', email)
    if (existing) {
      session.flash('error', 'A user with this email already exists.')
      return response.redirect().back()
    }

    // Generate a random password
    const randomPassword = randomBytes(8).toString('hex')

    const user = await User.create({
      email,
      fullName: full_name || null,
      passwordHash: randomPassword, // AuthFinder will hash this
    })

    session.flash('success', `User created successfully. Temporary password: ${randomPassword}`)
    return response.redirect().toRoute('cms.users.index')
  }

  async edit({ params, view }: HttpContext) {
    const user = await User.findOrFail(params.id)
    return view.render('pages/cms/users/edit', { editUser: user })
  }

  async update({ params, request, session, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const { full_name } = request.all()

    user.fullName = full_name || null
    await user.save()

    session.flash('success', `User "${user.email}" updated successfully.`)
    return response.redirect().toRoute('cms.users.index')
  }

  async resetPassword({ params, auth, session, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const currentUser = auth.user!

    // Can't reset own password from here
    if (user.id === currentUser.id) {
      session.flash('error', 'You cannot reset your own password from here. Use your Profile page.')
      return response.redirect().back()
    }

    // Can't reset root user's password
    if (user.isRoot) {
      session.flash('error', 'Root user password cannot be reset from here.')
      return response.redirect().back()
    }

    const newPassword = randomBytes(8).toString('hex')
    user.password = newPassword
    await user.save()

    session.flash('success', `Password reset for "${user.email}". New temporary password: ${newPassword}`)
    return response.redirect().toRoute('cms.users.index')
  }

  async destroy({ params, auth, session, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const currentUser = auth.user!

    if (user.isRoot) {
      session.flash('error', 'Root user cannot be deleted.')
      return response.redirect().back()
    }

    if (user.id === currentUser.id) {
      session.flash('error', 'You cannot delete your own account.')
      return response.redirect().back()
    }

    const email = user.email
    await user.delete()
    session.flash('success', `User "${email}" has been deleted.`)
    return response.redirect().toRoute('cms.users.index')
  }
}

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import UserService from '#services/user_service'

@inject()
export default class ProfilesController {
  constructor(protected userService: UserService) {}

  async index({ view }: HttpContext) {
    return view.render('pages/cms/profile/index')
  }

  async update({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const fullName = request.input('fullName')
    if (typeof fullName !== 'string') {
      session.flash('error', 'Name must be text.')
      return response.redirect().back()
    }

    try {
      await this.userService.updateProfile(user.id, fullName)
      session.flash('success', 'Profile updated successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async changePassword({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const currentPassword = request.input('currentPassword')
    const newPassword = request.input('newPassword')
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      newPassword.length < 12 ||
      newPassword.length > 128
    ) {
      session.flash('error', 'New password must be between 12 and 128 characters.')
      return response.redirect().back()
    }

    try {
      const updatedUser = await this.userService.changePassword(
        user.id,
        currentPassword,
        newPassword
      )
      session.put('authVersion', updatedUser.authVersion)
      session.flash('success', 'Password changed successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async updateAppearance({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const theme = request.input('theme')
    const accentColor = request.input('accentColor')
    const colorNumber = typeof accentColor === 'string' ? Number(accentColor) : accentColor
    if (typeof theme !== 'string' || !Number.isInteger(colorNumber)) {
      return response.status(422).json({ ok: false, error: 'Invalid appearance settings.' })
    }

    try {
      await this.userService.updateAppearance(user.id, theme, colorNumber as number)
      return response.json({ ok: true })
    } catch (error: any) {
      return response.status(422).json({ ok: false, error: error.message })
    }
  }
}

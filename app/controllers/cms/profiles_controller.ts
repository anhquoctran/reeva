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
    const { fullName } = request.all()
    
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
    const { currentPassword, newPassword } = request.all()

    try {
      await this.userService.changePassword(user.id, currentPassword, newPassword)
      session.flash('success', 'Password changed successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async updateAppearance({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const { theme, accentColor } = request.all()

    try {
      await this.userService.updateAppearance(user.id, theme, Number(accentColor))
      return response.json({ ok: true })
    } catch (error: any) {
      return response.status(422).json({ ok: false, error: error.message })
    }
  }
}

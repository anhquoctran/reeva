import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'

export default class ProfilesController {
  async index({ view }: HttpContext) {
    return view.render('pages/cms/profile/index')
  }

  async update({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const { fullName } = request.all()
    
    user.fullName = fullName
    await user.save()

    session.flash('success', 'Profile updated successfully.')
    return response.redirect().back()
  }

  async changePassword({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const { currentPassword, newPassword } = request.all()

    // 1. Check current password
    const isMatched = await hash.verify(user.passwordHash, currentPassword)
    if (!isMatched) {
      session.flash('error', 'Current password is incorrect.')
      return response.redirect().back()
    }

    // 2. Update to new password
    user.passwordHash = await hash.make(newPassword)
    await user.save()

    session.flash('success', 'Password changed successfully.')
    return response.redirect().back()
  }
}

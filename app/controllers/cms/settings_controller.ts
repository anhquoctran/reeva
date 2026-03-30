import Setting from '#models/setting'
import type { HttpContext } from '@adonisjs/core/http'

export default class SettingsController {
  async index({ view }: HttpContext) {
    const settings = await Setting.query().orderBy('key', 'asc')
    return view.render('pages/cms/settings/index', { settings })
  }

  async store({ request, response, session }: HttpContext) {
    const { key, value } = request.all()
    
    // Check if key already exists
    const existing = await Setting.findBy('key', key)
    if (existing) {
       session.flash('error', `Setting key "${key}" already exists.`)
       return response.redirect().back()
    }

    await Setting.create({ key, value })

    session.flash('success', 'Setting created successfully.')
    return response.redirect().back()
  }

  async update({ params, request, response, session }: HttpContext) {
    const setting = await Setting.findOrFail(params.id)
    const { value } = request.all()
    
    setting.value = value
    await setting.save()

    session.flash('success', `Setting "${setting.key}" updated.`)
    return response.redirect().back()
  }

  async destroy({ params, response, session }: HttpContext) {
    const setting = await Setting.findOrFail(params.id)
    await setting.delete()

    session.flash('success', 'Setting deleted successfully.')
    return response.redirect().back()
  }
}

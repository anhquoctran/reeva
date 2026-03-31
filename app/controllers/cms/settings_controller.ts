import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SettingService from '#services/setting_service'

@inject()
export default class SettingsController {
  constructor(protected settingService: SettingService) {}

  async index({ view }: HttpContext) {
    const settings = await this.settingService.getAllSettings()
    return view.render('pages/cms/settings/index', { settings })
  }

  async store({ request, response, session }: HttpContext) {
    const { key, value } = request.all()
    
    try {
      await this.settingService.createSetting(key, value)
      session.flash('success', 'Setting created successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async update({ params, request, response, session }: HttpContext) {
    const { value } = request.all()
    
    try {
      const setting = await this.settingService.updateSetting(params.id, value)
      session.flash('success', `Setting "${setting.key}" updated.`)
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async destroy({ params, response, session }: HttpContext) {
    try {
      await this.settingService.deleteSetting(params.id)
      session.flash('success', 'Setting deleted successfully.')
      return response.redirect().back()
    } catch (error: any) {
       session.flash('error', error.message)
       return response.redirect().back()
    }
  }
}

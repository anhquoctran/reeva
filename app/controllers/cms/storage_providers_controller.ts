import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import StorageProviderService from '#services/storage_provider_service'

@inject()
export default class StorageProvidersController {
  constructor(protected storageProviderService: StorageProviderService) {}

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    const providers = await this.storageProviderService.getPaginatedProviders(page, limit)
    providers.baseUrl(request.url())

    const defaultProvider = await this.storageProviderService.getDefaultProvider()

    let currentUsage = 0
    let usagePercentage = 0

    if (defaultProvider) {
      const usage = await this.storageProviderService.getUsageStats(defaultProvider)
      currentUsage = usage.currentUsage
      usagePercentage = usage.usagePercentage
    }

    return view.render('pages/cms/storage/index', { providers, defaultProvider, currentUsage, usagePercentage })
  }

  async activate({ params, response, session }: HttpContext) {
    try {
      await this.storageProviderService.activateProvider(params.id)
      session.flash('success', 'Storage provider activated successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async edit({ params, view }: HttpContext) {
    const provider = await this.storageProviderService.getProvider(params.id)
    return view.render('pages/cms/storage/edit', { provider })
  }

  async update({ params, request, response, session }: HttpContext) {
    const { name, config, quotaGb } = request.all()

    try {
      await this.storageProviderService.updateProvider(params.id, name, config, quotaGb)
      session.flash('success', 'Storage provider configuration updated.')
      return response.redirect().toRoute('cms.storage.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }
}
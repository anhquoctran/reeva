import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import StorageProviderService from '#services/storage_provider_service'
import { parsePage } from '#services/pagination'

@inject()
export default class StorageProvidersController {
  constructor(protected storageProviderService: StorageProviderService) {}

  async index({ request, response, view }: HttpContext) {
    const page = parsePage(request.input('page'))
    if (!page) return response.status(400).send('Invalid page.')
    const limit = 10
    const providers = await this.storageProviderService.getPaginatedProviders(page, limit)
    providers.baseUrl(request.url())

    const defaultProvider = await this.storageProviderService.getDefaultProvider()

    let currentUsage = 0
    let usagePercentage = 0
    let currentUsageFormatted = '0 KB'

    if (defaultProvider) {
      const usage = await this.storageProviderService.getUsageStats(defaultProvider)
      currentUsage = usage.currentUsage
      usagePercentage = usage.usagePercentage

      if (currentUsage > 0) {
        const kb = currentUsage / 1024
        if (kb <= 1000) {
          currentUsageFormatted = `${Number.parseFloat(kb.toFixed(2))} KB`
        } else {
          const mb = kb / 1024
          if (mb <= 1000) {
            currentUsageFormatted = `${Number.parseFloat(mb.toFixed(2))} MB`
          } else {
            const gb = mb / 1024
            if (gb <= 1000) {
              currentUsageFormatted = `${Number.parseFloat(gb.toFixed(2))} GB`
            } else {
              const tb = gb / 1024
              currentUsageFormatted = `${Number.parseFloat(tb.toFixed(2))} TB`
            }
          }
        }
      }
    }

    return view.render('pages/cms/storage/index', {
      providers,
      defaultProvider,
      currentUsage,
      usagePercentage,
      currentUsageFormatted,
    })
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
    return view.render('pages/cms/storage/edit', {
      provider: this.storageProviderService.getProviderEditView(provider),
    })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/storage/create')
  }

  async store({ request, response, session }: HttpContext) {
    try {
      await this.storageProviderService.createProvider(request.all())
      session.flash(
        'success',
        'Storage provider created. Activate it when you are ready to use it.'
      )
      return response.redirect().toRoute('cms.storage.index')
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined
      session.flash(
        'error',
        code
          ? 'Could not save the storage provider. Check its settings and try again.'
          : error instanceof Error
            ? error.message
            : 'Could not save the storage provider.'
      )
      return response.redirect().back()
    }
  }

  async update({ params, request, response, session }: HttpContext) {
    try {
      await this.storageProviderService.updateProvider(params.id, request.all())
      session.flash('success', 'Storage provider configuration updated.')
      return response.redirect().toRoute('cms.storage.index')
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined
      session.flash(
        'error',
        code
          ? 'Could not update the storage provider. Check its settings and try again.'
          : error instanceof Error
            ? error.message
            : 'Could not update the storage provider.'
      )
      return response.redirect().back()
    }
  }
}

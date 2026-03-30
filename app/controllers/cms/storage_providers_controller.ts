import db from '@adonisjs/lucid/services/db'
import StorageProvider from '#models/storage_provider'
import Artifact from '#models/artifact'
import StorageManager from '#services/storage/storage_manager'
import type { HttpContext } from '@adonisjs/core/http'

export default class StorageProvidersController {
  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    const providers = await StorageProvider.query().orderBy('isDefault', 'desc').orderBy('createdAt', 'desc').paginate(page, limit)
    providers.baseUrl(request.url())
    
    const defaultProvider = await StorageProvider.query().where('isDefault', true).first()
    
    let currentUsage = 0
    let usagePercentage = 0

    if (defaultProvider) {
      const usageResult = await Artifact.query()
        .where('storage_provider_id', defaultProvider.id)
        .sum('size_bytes as totalUsage')
        .first()
      
      const total = usageResult?.$extras.totalUsage
      currentUsage = total ? Number(total) : 0
      
      const quota = Number(defaultProvider.quotaBytes || 0)
      if (quota > 0) {
        usagePercentage = Math.min((currentUsage / quota) * 100, 100)
      }
      
      console.log(`[StorageUsage] Provider: ${defaultProvider.name} (${defaultProvider.id}), Total Usage: ${currentUsage} bytes, Quota: ${quota} bytes, Percentage: ${usagePercentage}%`)
    }
    
    return view.render('pages/cms/storage/index', { providers, defaultProvider, currentUsage, usagePercentage })
  }

  async activate({ params, response, session }: HttpContext) {
    await db.transaction(async (trx) => {
       // 1. Deactivate all
       await StorageProvider.query({ client: trx }).update({ isDefault: false })
       
       // 2. Activate the target
       const provider = await StorageProvider.findOrFail(params.id, { client: trx })
       provider.isDefault = true
       await provider.useTransaction(trx).save()
    })

    // Hot-reload the storage manager with the new active driver
    await StorageManager.boot()

    session.flash('success', 'Storage provider activated successfully.')
    return response.redirect().back()
  }

  async edit({ params, view }: HttpContext) {
    const provider = await StorageProvider.findOrFail(params.id)
    return view.render('pages/cms/storage/edit', { provider })
  }

  async update({ params, request, response, session }: HttpContext) {
    const provider = await StorageProvider.findOrFail(params.id)
    const { name, config, quotaGb } = request.all()
    
    provider.name = name
    provider.config = typeof config === 'string' ? JSON.parse(config) : config
    provider.quotaBytes = Number(quotaGb) * 1024 * 1024 * 1024
    await provider.save()

    // Re-boot if this is the active driver
    if (provider.isDefault) {
      await StorageManager.boot()
    }

    session.flash('success', 'Storage provider configuration updated.')
    return response.redirect().toRoute('cms.storage.index')
  }
}
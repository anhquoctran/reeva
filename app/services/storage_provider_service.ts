import { inject } from '@adonisjs/core'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import db from '@adonisjs/lucid/services/db'
import StorageProvider from '#models/storage_provider'

@inject()
export default class StorageProviderService {
  constructor(protected storageProviderRepository: StorageProviderRepository) {}

  async getPaginatedProviders(page: number, limit: number) {
    return await this.storageProviderRepository
      .query()
      .orderBy('isDefault', 'desc')
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)
  }

  async getDefaultProvider() {
    return await StorageProvider.query().where('isDefault', true).first()
  }

  async getUsageStats(provider: StorageProvider) {
    const usageResult = await db
      .from('artifacts')
      .where('storage_provider_id', provider.id)
      .sum({ totalUsage: 'size_bytes' })
      .first()

    const currentUsage = Number(usageResult?.totalUsage || 0)
    const quota = Number(provider.quotaBytes || 0)
    const usagePercentage = quota > 0 ? Math.min((currentUsage / quota) * 100, 100) : 0

    return { currentUsage, usagePercentage }
  }

  async activateProvider(id: string | number) {
    await db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 2)')
      await StorageProvider.query({ client: trx }).update({ isDefault: false })
      const provider = await StorageProvider.findOrFail(id, { client: trx })
      if (!provider.isActive) {
        throw new Error('An inactive storage provider cannot be activated.')
      }
      provider.isDefault = true
      await provider.useTransaction(trx).save()
    })
  }

  async getProvider(id: string | number) {
    return await this.storageProviderRepository.findById(id)
  }

  async updateProvider(id: string | number, name: string, config: any, quotaGb: number) {
    const provider = await this.storageProviderRepository.findById(id)
    const quota = Number(quotaGb)
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      throw new Error('Provider name is required and must be 100 characters or fewer.')
    }
    if (!Number.isFinite(quota) || quota < 0 || quota > 1_000_000) {
      throw new Error('Storage quota must be a non-negative finite GB value.')
    }

    let parsedConfig = config
    if (typeof config === 'string') {
      try {
        parsedConfig = JSON.parse(config)
      } catch {
        throw new Error('Storage provider config must be valid JSON.')
      }
    }
    if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
      throw new Error('Storage provider config must be a JSON object.')
    }

    provider.name = name.trim()
    provider.config = parsedConfig
    provider.quotaBytes = Math.round(quota * 1024 * 1024 * 1024)
    await provider.save()

    return provider
  }
}

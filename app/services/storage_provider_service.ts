import { inject } from '@adonisjs/core'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import ArtifactRepository from '#repositories/artifact_repository'
import StorageManager from '#services/storage/storage_manager'
import db from '@adonisjs/lucid/services/db'
import StorageProvider from '#models/storage_provider'

@inject()
export default class StorageProviderService {
  constructor(
    protected storageProviderRepository: StorageProviderRepository,
    protected artifactRepository: ArtifactRepository
  ) {}

  async getPaginatedProviders(page: number, limit: number) {
    return await this.storageProviderRepository.query()
      .orderBy('isDefault', 'desc')
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)
  }

  async getDefaultProvider() {
    return await StorageProvider.query().where('isDefault', true).first()
  }

  async getUsageStats(provider: StorageProvider) {
    const usageResult = await this.artifactRepository.query()
      .where('storage_provider_id', provider.id)
      .sum('size_bytes as totalUsage')
      .first()

    const currentUsage = Number(usageResult?.$extras.totalUsage || 0)
    const quota = Number(provider.quotaBytes || 0)
    const usagePercentage = quota > 0 ? Math.min((currentUsage / quota) * 100, 100) : 0

    return { currentUsage, usagePercentage }
  }

  async activateProvider(id: string | number) {
    await db.transaction(async (trx) => {
      await StorageProvider.query({ client: trx }).update({ isDefault: false })
      const provider = await StorageProvider.findOrFail(id, { client: trx })
      provider.isDefault = true
      await provider.useTransaction(trx).save()
    })

    await StorageManager.boot()
  }

  async getProvider(id: string | number) {
    return await this.storageProviderRepository.findById(id)
  }

  async updateProvider(id: string | number, name: string, config: any, quotaGb: number) {
    const provider = await this.storageProviderRepository.findById(id)

    provider.name = name
    provider.config = typeof config === 'string' ? JSON.parse(config) : config
    provider.quotaBytes = Number(quotaGb) * 1024 * 1024 * 1024
    await provider.save()

    if (provider.isDefault) {
      await StorageManager.boot()
    }

    return provider
  }
}

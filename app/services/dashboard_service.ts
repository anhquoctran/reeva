import { inject } from '@adonisjs/core'
import VersionRepository from '#repositories/version_repository'
import ArtifactRepository from '#repositories/artifact_repository'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import DownloadHistoryRepository from '#repositories/download_history_repository'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import StorageProvider from '#models/storage_provider'

@inject()
export default class DashboardService {
  constructor(
    protected versionRepository: VersionRepository,
    protected artifactRepository: ArtifactRepository,
    protected storageProviderRepository: StorageProviderRepository,
    protected downloadHistoryRepository: DownloadHistoryRepository
  ) {}

  async getStorageStats() {
    const defaultProvider = await StorageProvider.query().where('isDefault', true).first()
    const stats = {
      name: 'None',
      used: 0,
      quota: 0,
      percentage: 0,
      status: 'none' as string,
    }

    if (defaultProvider) {
      const usageResult = await this.artifactRepository.query()
        .where('storage_provider_id', defaultProvider.id)
        .sum('size_bytes as totalUsage')
        .first()

      const total = usageResult?.$extras.totalUsage
      stats.used = total ? Number(total) : 0
      stats.quota = Number(defaultProvider.quotaBytes || 0)
      stats.name = defaultProvider.name
      stats.status = defaultProvider.isActive ? 'healthy' : 'inactive'

      if (stats.quota > 0) {
        stats.percentage = Math.min((stats.used / stats.quota) * 100, 100)
      }
    }

    return stats
  }

  async getHealthStatus() {
    let dbStatus = 'healthy'
    try {
      await db.from('users').select('id').first()
    } catch {
      dbStatus = 'error'
    }

    const storage = await this.getStorageStats()

    return {
      db: dbStatus,
      storage,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime: Math.round(process.uptime()),
    }
  }

  async getDashboardData() {
    const now = DateTime.now()
    const todayStart = now.startOf('day')
    const weekStart = now.minus({ days: 7 }).startOf('day')
    const monthStart = now.minus({ days: 30 }).startOf('day')

    // Metrics counts
    const [
      totalVersionsResult,
      totalArtifactsResult,
      activeSPResult,
      downloadsTotalResult,
      statsToday,
      statsWeek,
      statsMonth,
    ] = await Promise.all([
      this.versionRepository.query().count('* as total').first(),
      this.artifactRepository.query().count('* as total').first(),
      this.storageProviderRepository.query().count('* as total').first(),
      db.from('artifacts').sum('download_count as total').first() as Promise<{ total: number | null } | undefined>,
      this.downloadHistoryRepository.query().where('createdAt', '>=', todayStart.toSQL()!).count('* as total').first(),
      this.downloadHistoryRepository.query().where('createdAt', '>=', weekStart.toSQL()!).count('* as total').first(),
      this.downloadHistoryRepository.query().where('createdAt', '>=', monthStart.toSQL()!).count('* as total').first(),
    ])

    // Chart data
    const [last24h, last7d, last30d] = await Promise.all([
      db.from('download_histories')
        .select(db.raw('HOUR(created_at) as hour'))
        .count('* as total')
        .where('created_at', '>=', now.minus({ hours: 24 }).toSQL()!)
        .groupBy('hour')
        .orderBy('hour', 'asc'),

      db.from('download_histories')
        .select(db.raw('DATE(created_at) as date'))
        .count('* as total')
        .where('created_at', '>=', weekStart.toSQL()!)
        .groupBy('date')
        .orderBy('date', 'asc'),

      db.from('download_histories')
        .select(db.raw('DATE(created_at) as date'))
        .count('* as total')
        .where('created_at', '>=', monthStart.toSQL()!)
        .groupBy('date')
        .orderBy('date', 'asc'),
    ])

    const formatHour = (h: number) => `${h}:00`
    const formatDate = (dateStr: string) => {
      const d = DateTime.fromISO(dateStr)
      return d.isValid ? d.toFormat('LLL d') : dateStr
    }

    const allChartData = {
      today: last24h.map((d: any) => ({ label: formatHour(d.hour), total: Number(d.total) })),
      week: last7d.map((d: any) => ({ label: formatDate(d.date), total: Number(d.total) })),
      month: last30d.map((d: any) => ({ label: formatDate(d.date), total: Number(d.total) })),
    }

    // System health
    const health = await this.getHealthStatus()
    const pkgPath = join(app.makePath(), 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))

    // Recent artifacts
    const recentArtifacts = await this.artifactRepository.query()
      .preload('version')
      .preload('platform')
      .orderBy('createdAt', 'desc')
      .limit(5)

    return {
      stats: {
        versions: totalVersionsResult?.$extras.total || 0,
        artifacts: totalArtifactsResult?.$extras.total || 0,
        storageProviders: activeSPResult?.$extras.total || 0,
        downloads: Number(downloadsTotalResult?.total || 0),
        today: statsToday?.$extras.total || 0,
        week: statsWeek?.$extras.total || 0,
        month: statsMonth?.$extras.total || 0,
      },
      allChartData,
      health: {
        ...health,
        version: pkg.version,
      },
      recentArtifacts,
    }
  }
}

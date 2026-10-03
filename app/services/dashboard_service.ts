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
import Software from '#models/software'

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
      const usageResult = await db
        .from('artifacts')
        .where('storage_provider_id', defaultProvider.id)
        .sum({ totalUsage: 'size_bytes' })
        .first()

      const total = usageResult?.totalUsage
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

    let storage
    try {
      storage = await this.getStorageStats()
    } catch {
      storage = { name: 'Unknown', used: 0, quota: 0, percentage: 0, status: 'error' }
    }

    return {
      db: dbStatus,
      storage,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime: Math.round(process.uptime()),
    }
  }

  async getDashboardData() {
    const now = DateTime.utc()
    const todayStart = now.startOf('day')
    const weekStart = now.minus({ days: 7 }).startOf('day')
    const monthStart = now.minus({ days: 30 }).startOf('day')

    // Metrics counts
    const [
      totalVersionsResult,
      totalSoftwareResult,
      totalArtifactsResult,
      activeSPResult,
      downloadsTotalResult,
      statsToday,
      statsWeek,
      statsMonth,
    ] = await Promise.all([
      this.versionRepository.query().count('* as total').first(),
      Software.query().count('* as total').first(),
      this.artifactRepository.query().count('* as total').first(),
      this.storageProviderRepository.query().count('* as total').first(),
      db.from('artifacts').sum('download_count as total').first() as Promise<
        { total: number | null } | undefined
      >,
      this.downloadHistoryRepository
        .query()
        .where('createdAt', '>=', todayStart.toSQL()!)
        .count('* as total')
        .first(),
      this.downloadHistoryRepository
        .query()
        .where('createdAt', '>=', weekStart.toSQL()!)
        .count('* as total')
        .first(),
      this.downloadHistoryRepository
        .query()
        .where('createdAt', '>=', monthStart.toSQL()!)
        .count('* as total')
        .first(),
    ])

    // Chart data
    const hourBucket = "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:00:00')"
    const dateBucket = "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"

    const [last24h, last7d, last30d] = await Promise.all([
      db
        .from('download_histories')
        .whereNull('deleted_at')
        .select(db.raw(`${hourBucket} as hour`))
        .count('* as total')
        .where('created_at', '>=', now.minus({ hours: 24 }).toSQL()!)
        .groupByRaw(hourBucket)
        .orderBy('hour', 'asc'),

      db
        .from('download_histories')
        .whereNull('deleted_at')
        .select(db.raw(`${dateBucket} as date`))
        .count('* as total')
        .where('created_at', '>=', weekStart.toSQL()!)
        .groupByRaw(dateBucket)
        .orderBy('date', 'asc'),

      db
        .from('download_histories')
        .whereNull('deleted_at')
        .select(db.raw(`${dateBucket} as date`))
        .count('* as total')
        .where('created_at', '>=', monthStart.toSQL()!)
        .groupByRaw(dateBucket)
        .orderBy('date', 'asc'),
    ])

    const formatHour = (value: string | Date) => {
      const dateTime =
        value instanceof Date
          ? DateTime.fromJSDate(value, { zone: 'utc' })
          : DateTime.fromSQL(value, { zone: 'utc' })
      return dateTime.isValid ? dateTime.toFormat('HH:00') : String(value)
    }
    const formatDate = (value: string | Date) => {
      const dateTime =
        value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(String(value))
      return dateTime.isValid ? dateTime.toFormat('LLL d') : String(value)
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
    const recentArtifacts = await this.artifactRepository
      .query()
      .preload('version', (versionQuery) => versionQuery.preload('software'))
      .preload('platform')
      .orderBy('createdAt', 'desc')
      .limit(5)

    return {
      stats: {
        versions: Number(totalVersionsResult?.$extras.total || 0),
        software: Number(totalSoftwareResult?.$extras.total || 0),
        artifacts: Number(totalArtifactsResult?.$extras.total || 0),
        storageProviders: Number(activeSPResult?.$extras.total || 0),
        downloads: Number(downloadsTotalResult?.total || 0),
        today: Number(statsToday?.$extras.total || 0),
        week: Number(statsWeek?.$extras.total || 0),
        month: Number(statsMonth?.$extras.total || 0),
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

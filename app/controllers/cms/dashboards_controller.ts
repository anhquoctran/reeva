import type { HttpContext } from '@adonisjs/core/http'
import Version from '#models/version'
import Artifact from '#models/artifact'
import StorageProvider from '#models/storage_provider'
import DownloadHistory from '#models/download_history'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'

export default class DashboardsController {
  private async getStorageStats() {
    const defaultProvider = await StorageProvider.query().where('isDefault', true).first()
    let stats = {
      name: 'None',
      used: 0,
      quota: 0,
      percentage: 0,
      status: 'none'
    }

    if (defaultProvider) {
      const usageResult = await Artifact.query()
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

  async health({ response }: HttpContext) {
    let dbStatus = 'healthy'
    try {
      await db.from('users').select('id').first()
    } catch {
      dbStatus = 'error'
    }

    const storage = await this.getStorageStats()

    return response.json({
      db: dbStatus,
      storage,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime: Math.round(process.uptime())
    })
  }

  async index({ view }: HttpContext) {
    // 1. Fetch Metrics
    const totalVersionsResult = await Version.query().count('* as total').first()
    const totalArtifactsResult = await Artifact.query().count('* as total').first()
    const activeSPResult = await StorageProvider.query().count('* as total').first()

    // Sum downloadCount from all artifacts for total downloads
    const downloadsTotalResult = await db.from('artifacts').sum('download_count as total').first() as { total: number | null } | undefined
    const totalOverallDownloads = Number(downloadsTotalResult?.total || 0)

    // 2. Fetch Granular Stats (Today, Week, Month)
    const now = DateTime.now()
    const todayStart = now.startOf('day')
    const weekStart = now.minus({ days: 7 }).startOf('day')
    const monthStart = now.minus({ days: 30 }).startOf('day')

    const statsToday = await DownloadHistory.query().where('createdAt', '>=', todayStart.toSQL()!).count('* as total').first()
    const statsWeek = await DownloadHistory.query().where('createdAt', '>=', weekStart.toSQL()!).count('* as total').first()
    const statsMonth = await DownloadHistory.query().where('createdAt', '>=', monthStart.toSQL()!).count('* as total').first()

    // 3. Multi-Period Chart Data
    const last24h = await db.from('download_histories')
      .select(db.raw('HOUR(created_at) as hour'))
      .count('* as total')
      .where('created_at', '>=', now.minus({ hours: 24 }).toSQL()!)
      .groupBy('hour')
      .orderBy('hour', 'asc')

    const last7d = await db.from('download_histories')
      .select(db.raw('DATE(created_at) as date'))
      .count('* as total')
      .where('created_at', '>=', weekStart.toSQL()!)
      .groupBy('date')
      .orderBy('date', 'asc')

    const last30d = await db.from('download_histories')
      .select(db.raw('DATE(created_at) as date'))
      .count('* as total')
      .where('created_at', '>=', monthStart.toSQL()!)
      .groupBy('date')
      .orderBy('date', 'asc')

    // Data Formatter Helpers
    const formatHour = (h: number) => `${h}:00`
    const formatDate = (dateStr: string) => {
      const d = DateTime.fromISO(dateStr)
      return d.isValid ? d.toFormat('LLL d') : dateStr
    }

    const allChartData = {
      today: last24h.map(d => ({ label: formatHour(d.hour), total: Number(d.total) })),
      week: last7d.map(d => ({ label: formatDate(d.date), total: Number(d.total) })),
      month: last30d.map(d => ({ label: formatDate(d.date), total: Number(d.total) }))
    }

    // 4. System Health Data
    let dbStatus = 'healthy'
    try {
      await db.from('users').select('id').first()
    } catch {
      dbStatus = 'error'
    }

    const storageStats = await this.getStorageStats()

    const pkgPath = join(app.makePath(), 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))

    // 5. Recent Artifacts
    const recentArtifacts = await Artifact.query()
      .preload('version')
      .preload('platform')
      .orderBy('createdAt', 'desc')
      .limit(5)

    return view.render('pages/cms/dashboard', {
      stats: {
        versions: totalVersionsResult?.$extras.total || 0,
        artifacts: totalArtifactsResult?.$extras.total || 0,
        storageProviders: activeSPResult?.$extras.total || 0,
        downloads: totalOverallDownloads,
        today: statsToday?.$extras.total || 0,
        week: statsWeek?.$extras.total || 0,
        month: statsMonth?.$extras.total || 0
      },
      allChartData,
      health: {
        db: dbStatus,
        storage: storageStats,
        version: pkg.version,
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime: Math.round(process.uptime())
      },
      recentArtifacts
    })
  }
}
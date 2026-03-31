import { inject } from '@adonisjs/core'
import ArtifactRepository from '#repositories/artifact_repository'
import PlatformRepository from '#repositories/platform_repository'
import ArchitectureRepository from '#repositories/architecture_repository'
import StorageManager from '#services/storage/storage_manager'
import DownloadHistory from '#models/download_history'
import Platform from '#models/platform'
import Architecture from '#models/architecture'
import semver from 'semver'

@inject()
export default class UpdaterService {
  constructor(
    protected artifactRepository: ArtifactRepository,
    protected platformRepository: PlatformRepository,
    protected architectureRepository: ArchitectureRepository
  ) { }

  async checkForUpdate(platform: string, arch: string, version: string, channel: string) {
    const p = await Platform.findBy('name', platform)
    const a = await Architecture.findBy('name', arch)

    if (!p || !a) {
      throw new Error('Platform or architecture not supported.')
    }

    const artifacts = await this.artifactRepository.query()
      .join('versions as v', 'v.id', 'artifacts.version_id')
      .where('artifacts.platform_id', p.id)
      .where('artifacts.architecture_id', a.id)
      .where('artifacts.channel', channel)
      .where('artifacts.is_published', true)
      .where('v.is_active', true)
      .select('artifacts.*')
      .preload('version')
      .orderBy('v.major', 'desc')
      .orderBy('v.minor', 'desc')
      .orderBy('v.patch', 'desc')

    const update = artifacts.find((art) => {
      const vStr = `${art.version.major}.${art.version.minor}.${art.version.patch}`
      return semver.valid(vStr) && semver.gt(vStr, version)
    })

    return update ?? null
  }

  async getLatest(platform: string, arch: string, channel: string) {
    return await this.artifactRepository.query()
      .join('versions as v', 'v.id', 'artifacts.version_id')
      .join('platforms as p', 'p.id', 'artifacts.platform_id')
      .join('architectures as ar', 'ar.id', 'artifacts.architecture_id')
      .where('p.name', platform)
      .where('ar.name', arch)
      .where('artifacts.channel', channel)
      .where('artifacts.is_published', true)
      .where('v.is_active', true)
      .select('artifacts.*')
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .orderBy('v.major', 'desc')
      .orderBy('v.minor', 'desc')
      .orderBy('v.patch', 'desc')
      .first()
  }

  async getGeoLocation(ipAddress: string) {
    const response = await fetch(`http://ip-api.com/json/${ipAddress}`)
    const data = await response.json() as { lat: number, lon: number, countryCode: string };
    return { lat: data.lat, lng: data.lon, countryCode: data.countryCode }
  }

  async recordAndStream(artifactId: string | number, ipAddress: string, userAgent?: string) {
    const Artifact = (await import('#models/artifact')).default
    const artifact = await Artifact.findOrFail(artifactId)
    await artifact.load('storageProvider')

    if (!artifact.storageProvider) {
      throw new Error('Malformed artifact: storage provider missing.')
    }

    const storage = StorageManager.resolve(artifact.storageProvider)
    const stream = await storage.getStream(artifact.storageKey)

    // Track download metric & history
    artifact.downloadCount = (artifact.downloadCount || 0) + 1
    await artifact.save()
    const geolocation = await this.getGeoLocation(ipAddress)

    await DownloadHistory.create({
      artifactId: artifact.id,
      ipAddress,
      userAgent,
      ...geolocation,
    })

    return { artifact, stream }
  }
}

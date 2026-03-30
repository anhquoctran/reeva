import Artifact from '#models/artifact'
import DownloadHistory from '#models/download_history'
import Platform from '#models/platform'
import Architecture from '#models/architecture'
import StorageManager from '#services/storage/storage_manager'
import type { HttpContext } from '@adonisjs/core/http'
import semver from 'semver'

export default class UpdaterController {
  /**
   * @check
   * @summary Check for available software updates
   * @description Compares the provided version against the latest published version in the specified channel.
   * @paramQuery platform - Target platform - r - string - windows
   * @paramQuery arch - Target architecture - r - string - x64
   * @paramQuery version - Current client version - r - string - 1.0.0
   * @paramQuery channel - Release channel - string - stable
   * @responseBody 200 - { "version": "1.1.0", "codename": "Rocket", "changelog": "Bug fixes", "channel": "stable", "downloadUrl": "http://api/download/id", "checksum": "sha256...", "sizeBytes": 50000, "publishedAt": "2024-01-01" }
   * @responseBody 204 - No update found
   * @responseBody 400 - { "error": "Missing parameters" }
   * @responseBody 404 - { "error": "Platform/Arch not supported" }
   */
  async check({ request, response }: HttpContext) {
    const { platform, arch, version, channel = 'stable' } = request.all()

    if (!platform || !arch || !version) {
      return response.status(400).json({ error: 'Missing platform, arch, or version check parameters.' })
    }

    // 1. Resolve Platform and Architecture
    const p = await Platform.findBy('name', platform)
    const a = await Architecture.findBy('name', arch)

    if (!p || !a) {
      return response.status(404).json({ error: 'Platform or architecture not supported.' })
    }

    // 2. Fetch artifacts for the given context using optimized joins and sorting
    const artifacts = await Artifact.query()
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

    // 3. Find first newer version (already sorted by latest)
    const update = artifacts.find(art => {
      const vStr = `${art.version.major}.${art.version.minor}.${art.version.patch}`
      return semver.valid(vStr) && semver.gt(vStr, version)
    })

    if (!update) {
      return response.status(204).send('')
    }

    return response.json({
      version: `${update.version.major}.${update.version.minor}.${update.version.patch}`,
      codename: update.version.codename,
      changelog: update.version.changelog,
      channel: update.channel,
      downloadUrl: `${request.protocol()}://${request.host()}/api/download/${update.id}`,
      checksum: update.checksum,
      sizeBytes: update.sizeBytes,
      publishedAt: update.publishedAt
    })
  }

  /**
   * @latest
   * @summary Get absolute latest version metadata
   * @description Returns the most recent release binary details for a specific platform and architecture.
   * @paramQuery platform - Target platform - r - string - windows
   * @paramQuery arch - Target architecture - r - string - x64
   * @paramQuery channel - Release channel - string - stable
   * @responseBody 200 - { "version": "1.5.0", "codename": "Stable", "platform": "windows", "arch": "x64", "channel": "stable", "fileName": "app.exe", "sizeBytes": 1234, "downloadUrl": "http://..." }
   * @responseBody 400 - { "error": "Missing parameters" }
   * @responseBody 404 - { "error": "No releases found" }
   */
  async latest({ request, response }: HttpContext) {
    const { platform, arch, channel = 'stable', currentVersion } = request.all()

    if (!platform || !arch) {
      return response.status(400).json({ error: 'Missing platform or arch parameters.' })
    }

    const artifact = await Artifact.query()
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

    if (!artifact) {
       return response.status(404).json({ error: 'No releases found for the specified platform context.' })
    }

    const vStr = `${artifact.version.major}.${artifact.version.minor}.${artifact.version.patch}`
    const hasUpdate = currentVersion ? (semver.valid(vStr) && semver.valid(currentVersion) && semver.gt(vStr, currentVersion)) : true

    return response.json({
       version: vStr,
       codename: artifact.version.codename,
       changelog: artifact.version.changelog,
       platform: artifact.platform.name,
       arch: artifact.architecture.name,
       channel: artifact.channel,
       fileName: artifact.fileName,
       sizeBytes: artifact.sizeBytes,
       checksum: artifact.checksum,
       hasUpdate,
       downloadUrl: `${request.protocol()}://${request.host()}/api/download/${artifact.id}`
    })
  }

  /**
   * @download
   * @summary Stream artifact binary file
   * @description Proxies the download from the storage provider to the client. Increments download metrics.
   * @paramPath id - The unique ID of the artifact - r - string - 123-456
   * @responseBody 200 - binary file
   * @responseBody 404 - Artifact not found
   * @responseBody 500 - Storage provider issue
   */
  async download({ request, params, response }: HttpContext) {
    const artifact = await Artifact.findOrFail(params.id)
    await artifact.load('storageProvider')
    
    if (!artifact.storageProvider) {
      return response.status(500).json({ error: 'Malformed artifact: storage provider missing.' })
    }

    const storage = StorageManager.resolve(artifact.storageProvider)
    const stream = await storage.getStream(artifact.storageKey)

    // Track download metric & history
    artifact.downloadCount = (artifact.downloadCount || 0) + 1
    await artifact.save()

    await DownloadHistory.create({
      artifactId: artifact.id,
      ipAddress: request.ip(),
      userAgent: request.header('user-agent')
    })

    // Configure headers for secure proxied download
    response.header('Content-Type', artifact.mimeType || 'application/octet-stream')
    if (artifact.sizeBytes) {
      response.header('Content-Length', Number(artifact.sizeBytes))
    }
    response.header('Content-Disposition', `attachment; filename="${artifact.fileName}"`)

    return response.stream(stream)
  }
}
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import UpdaterService from '#services/updater_service'
import semver from 'semver'

@inject()
export default class UpdaterController {
  constructor(protected updaterService: UpdaterService) { }

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

    try {
      const update = await this.updaterService.checkForUpdate(platform, arch, version, channel)

      if (!update) {
        return response.status(204).send('')
      }

      return response.json({
        version: `${update.version.major}.${update.version.minor}.${update.version.patch}`,
        codename: update.version.codename,
        changelog: update.version.changelog,
        channel: update.channel,
        downloadUrl: `${request.protocol()}://${request.host()}/api/download/${update.id}`,
        md5: update.checksumMd5,
        sha1: update.checksumSha1,
        sha256: update.checksumSha256,
        sha512: update.checksumSha512,
        sizeBytes: update.sizeBytes,
        publishedAt: update.publishedAt,
      })
    } catch (error: any) {
      return response.status(404).json({ error: error.message })
    }
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

    const artifact = await this.updaterService.getLatest(platform, arch, channel)

    if (!artifact) {
      return response.status(404).json({ error: 'No releases found for the specified platform context.' })
    }

    const vStr = `${artifact.version.major}.${artifact.version.minor}.${artifact.version.patch}`
    const hasUpdate = currentVersion
      ? semver.valid(vStr) && semver.valid(currentVersion) && semver.gt(vStr, currentVersion)
      : true

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
      downloadUrl: `${request.protocol()}://${request.host()}/api/download/${artifact.id}`,
    })
  }

  /**
   * @releases
   * @summary Get paginated list of published releases
   * @description Returns a paginated list of published artifacts (old versions included) for platform + arch + channel.
   * @paramQuery platform - Target platform - r - string - windows
   * @paramQuery arch - Target architecture - r - string - x64
   * @paramQuery channel - Release channel - string - stable
   * @paramQuery page - Page number - number - 1
   * @paramQuery limit - Page size - number - 20
   * @responseBody 200 - [{ "version": "1.5.0", ... }]
   * @responseBody 400 - { "error": "Missing parameters" }
   * @responseBody 404 - { "error": "No releases found" }
   */
  async releases({ request, response }: HttpContext) {
    const { platform, arch, channel = 'stable', page = 1, limit = 20 } = request.all()

    if (!platform || !arch) {
      return response.status(400).json({ error: 'Missing platform or arch parameters.' })
    }

    try {
      const { results, pagination } = await this.updaterService.getReleases(platform, arch, channel, Number(limit), Number(page))

      if (!results.length) {
        return response.status(404).json({ error: 'No releases found for the specified platform context.' })
      }

      return response.json({
        data: results.map((artifact) => {
          const version = `${artifact.version.major}.${artifact.version.minor}.${artifact.version.patch}`
          return {
            id: artifact.id,
            version,
            codename: artifact.version.codename,
            changelog: artifact.version.changelog,
            platform: artifact.platform.name,
            arch: artifact.architecture.name,
            channel: artifact.channel,
            fileName: artifact.fileName,
            sizeBytes: artifact.sizeBytes,
            checksum: artifact.checksum,
            publishedAt: artifact.publishedAt,
            downloadUrl: `${request.protocol()}://${request.host()}/api/download/${artifact.id}`,
          }
        }),
        pagination
      })
    } catch (error: any) {
      return response.status(404).json({ error: error.message })
    }
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
  async download({ request, params, response, incomingIp }: HttpContext) {
    try {
      const { artifact, stream } = await this.updaterService.recordAndStream(
        params.id,
        incomingIp,
        request.header('user-agent')
      )

      response.header('Content-Type', artifact.mimeType || 'application/octet-stream')
      if (artifact.sizeBytes) {
        response.header('Content-Length', Number(artifact.sizeBytes))
      }
      response.header('Content-Disposition', `attachment; filename="${artifact.fileName}"`)

      return response.stream(stream)
    } catch (error: any) {
      if (error.message?.includes('Missing artifact') || error.message?.includes('storage provider')) {
        return response.status(500).json({ error: error.message })
      }
      return response.status(404).json({ error: 'Artifact not found.' })
    }
  }
}
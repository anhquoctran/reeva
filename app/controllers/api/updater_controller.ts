import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { appUrl } from '#config/app'
import UpdaterService, {
  ArtifactStorageError,
  PublicArtifactNotFoundError,
  PublicSoftwareNotFoundError,
  UnsupportedReleaseTargetError,
} from '#services/updater_service'
import { attachmentDisposition } from '#services/download_headers'
import logger from '@adonisjs/core/services/logger'
import semver from 'semver'
import { createOtaSignatureEnvelope } from '#services/ota_release_signature_service'

const CHANNELS = new Set(['dev', 'staging', 'beta', 'stable'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readText(value: unknown, required = true) {
  if (typeof value !== 'string') return required ? null : undefined
  const normalized = value.trim()
  if (!normalized && required) return null
  if (normalized.length > 100) return null
  return normalized || undefined
}

function releaseContext(request: HttpContext['request']) {
  const platform = readText(request.input('platform'))
  const arch = readText(request.input('arch'))
  const channel = readText(request.input('channel', 'stable'))

  if (
    !platform ||
    !arch ||
    !/^[a-z0-9_-]+$/i.test(platform) ||
    !/^[a-z0-9_-]+$/i.test(arch) ||
    !channel ||
    !CHANNELS.has(channel)
  ) {
    return null
  }

  return { platform, arch, channel }
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null
}

function getDownloadUrl(id: string, softwareSlug?: string) {
  const path = softwareSlug
    ? `/api/software/${encodeURIComponent(softwareSlug)}/download/${id}`
    : `/api/download/${id}`
  return new URL(path, appUrl).toString()
}

@inject()
export default class UpdaterController {
  constructor(protected updaterService: UpdaterService) {}

  /** @summary Check for a newer published artifact in a release channel. */
  async check({ request, response, params }: HttpContext) {
    const context = releaseContext(request)
    const version = readText(request.input('version'))
    if (!context || !version || !semver.valid(version)) {
      return response.status(400).json({ error: 'Invalid platform, arch, channel, or version.' })
    }

    try {
      const update = await this.updaterService.checkForUpdate(
        context.platform,
        context.arch,
        version,
        context.channel,
        params.slug
      )
      if (!update) return response.status(204).send('')

      return response.json({
        version: `${update.version.major}.${update.version.minor}.${update.version.patch}`,
        codename: update.version.codename,
        changelog: update.version.changelog,
        channel: update.channel,
        downloadUrl: getDownloadUrl(update.id, params.slug),
        md5: update.checksumMd5,
        sha1: update.checksumSha1,
        sha256: update.checksumSha256,
        sha512: update.checksumSha512,
        sizeBytes: update.sizeBytes,
        publishedAt: update.publishedAt,
        signedManifest: createOtaSignatureEnvelope(update),
      })
    } catch (error) {
      if (error instanceof UnsupportedReleaseTargetError) {
        return response.status(404).json({ error: 'Platform or architecture not supported.' })
      }
      if (error instanceof PublicSoftwareNotFoundError) {
        return response.status(404).json({ error: 'Software not found.' })
      }
      throw error
    }
  }

  /** @summary Return the newest published release for a platform and architecture. */
  async latest({ request, response, params }: HttpContext) {
    const context = releaseContext(request)
    const rawCurrentVersion = request.input('currentVersion')
    const currentVersion =
      rawCurrentVersion === undefined || rawCurrentVersion === ''
        ? undefined
        : readText(rawCurrentVersion, false)
    if (
      !context ||
      (rawCurrentVersion !== undefined &&
        rawCurrentVersion !== '' &&
        (!currentVersion || !semver.valid(currentVersion)))
    ) {
      return response
        .status(400)
        .json({ error: 'Invalid platform, arch, channel, or currentVersion.' })
    }

    let artifact
    try {
      artifact = await this.updaterService.getLatest(
        context.platform,
        context.arch,
        context.channel,
        params.slug
      )
    } catch (error) {
      if (error instanceof PublicSoftwareNotFoundError) {
        return response.status(404).json({ error: 'Software not found.' })
      }
      throw error
    }
    if (!artifact) {
      return response
        .status(404)
        .json({ error: 'No releases found for the specified platform context.' })
    }

    const version = `${artifact.version.major}.${artifact.version.minor}.${artifact.version.patch}`
    const hasUpdate = currentVersion ? semver.gt(version, currentVersion) : true

    return response.json({
      version,
      codename: artifact.version.codename,
      changelog: artifact.version.changelog,
      platform: artifact.platform.name,
      arch: artifact.architecture.name,
      channel: artifact.channel,
      fileName: artifact.fileName,
      sizeBytes: artifact.sizeBytes,
      checksum: artifact.checksum,
      hasUpdate,
      downloadUrl: getDownloadUrl(artifact.id, params.slug),
      signedManifest: createOtaSignatureEnvelope(artifact),
    })
  }

  /** @summary Return a bounded page of published releases. */
  async releases({ request, response, params }: HttpContext) {
    const context = releaseContext(request)
    const page = positiveInteger(request.input('page'), 1, 1_000_000)
    const limit = positiveInteger(request.input('limit'), 20, 100)
    if (!context || !page || !limit) {
      return response
        .status(400)
        .json({ error: 'Invalid platform, arch, channel, page, or limit.' })
    }

    try {
      const { results, pagination } = await this.updaterService.getReleases(
        context.platform,
        context.arch,
        context.channel,
        limit,
        page,
        params.slug
      )
      if (!results.length) {
        return response
          .status(404)
          .json({ error: 'No releases found for the specified platform context.' })
      }

      return response.json({
        data: results.map((artifact) => ({
          id: artifact.id,
          version: `${artifact.version.major}.${artifact.version.minor}.${artifact.version.patch}`,
          codename: artifact.version.codename,
          changelog: artifact.version.changelog,
          platform: artifact.platform.name,
          arch: artifact.architecture.name,
          channel: artifact.channel,
          fileName: artifact.fileName,
          sizeBytes: artifact.sizeBytes,
          checksum: artifact.checksum,
          publishedAt: artifact.publishedAt,
          downloadUrl: getDownloadUrl(artifact.id, params.slug),
          signedManifest: createOtaSignatureEnvelope(artifact),
        })),
        pagination,
      })
    } catch (error) {
      if (error instanceof UnsupportedReleaseTargetError) {
        return response.status(404).json({ error: 'Platform or architecture not supported.' })
      }
      if (error instanceof PublicSoftwareNotFoundError) {
        return response.status(404).json({ error: 'Software not found.' })
      }
      throw error
    }
  }

  /** @summary Stream a published artifact and record a download attempt. */
  async download({ params, response, incomingIp, request }: HttpContext) {
    if (!UUID_PATTERN.test(params.id)) {
      return response.status(404).json({ error: 'Artifact not found.' })
    }

    try {
      const { artifact, stream } = await this.updaterService.recordAndStream(
        params.id,
        incomingIp,
        request.header('user-agent'),
        params.slug
      )

      response.header('Content-Type', 'application/octet-stream')
      response.header('X-Content-Type-Options', 'nosniff')
      response.header('Content-Disposition', attachmentDisposition(artifact.fileName))
      if (artifact.sizeBytes !== null && artifact.sizeBytes !== undefined) {
        response.header('Content-Length', String(artifact.sizeBytes))
      }

      return response.stream(stream)
    } catch (error) {
      if (error instanceof PublicArtifactNotFoundError) {
        return response.status(404).json({ error: 'Artifact not found.' })
      }
      if (error instanceof PublicSoftwareNotFoundError) {
        return response.status(404).json({ error: 'Software not found.' })
      }
      if (error instanceof ArtifactStorageError) {
        logger.error({ err: error, artifactId: params.id }, 'Artifact download failed')
        return response.status(503).json({ error: 'Artifact storage is temporarily unavailable.' })
      }
      throw error
    }
  }
}

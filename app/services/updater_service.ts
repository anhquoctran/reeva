import { inject } from '@adonisjs/core'
import ArtifactRepository from '#repositories/artifact_repository'
import SoftwareRepository from '#repositories/software_repository'
import Software from '#models/software'
import Platform from '#models/platform'
import Architecture from '#models/architecture'
import StorageManager from '#services/storage/storage_manager'
import DownloadHistory from '#models/download_history'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { isIP } from 'node:net'
import semver from 'semver'
import { Readable } from 'node:stream'

export class PublicArtifactNotFoundError extends Error {}
export class ArtifactStorageError extends Error {}
export class UnsupportedReleaseTargetError extends Error {}
export class PublicSoftwareNotFoundError extends Error {}

@inject()
export default class UpdaterService {
  constructor(
    protected artifactRepository: ArtifactRepository,
    protected softwareRepository: SoftwareRepository
  ) {}

  private async resolveSoftware(slug?: string): Promise<Software> {
    const software = slug
      ? await this.softwareRepository.findActiveBySlug(slug)
      : await this.softwareRepository.findActiveDefault()
    if (!software) throw new PublicSoftwareNotFoundError('Software is not available.')
    return software
  }

  async checkForUpdate(
    platform: string,
    arch: string,
    version: string,
    channel: string,
    softwareSlug?: string
  ) {
    const current = semver.parse(version)
    if (!current) throw new Error('Invalid semantic version.')

    const [software, platformRow, architectureRow] = await Promise.all([
      this.resolveSoftware(softwareSlug),
      Platform.findBy('name', platform),
      Architecture.findBy('name', arch),
    ])
    if (!platformRow || !architectureRow) {
      throw new UnsupportedReleaseTargetError('Platform or architecture not supported.')
    }

    const update = await this.artifactRepository
      .publicQuery(software.id)
      .join('versions as v', 'v.id', 'artifacts.version_id')
      .where('artifacts.platform_id', platformRow.id)
      .where('artifacts.architecture_id', architectureRow.id)
      .where('artifacts.channel', channel)
      .where((query) => {
        query
          .where('v.major', '>', current.major)
          .orWhere((major) =>
            major.where('v.major', current.major).where('v.minor', '>', current.minor)
          )
          .orWhere((minor) =>
            minor
              .where('v.major', current.major)
              .where('v.minor', current.minor)
              .where('v.patch', '>', current.patch)
          )

        // A stable DB release is newer than a pre-release with the same core
        // version (for example 1.2.0 is newer than 1.2.0-rc.1).
        if (current.prerelease.length) {
          query.orWhere((sameCore) =>
            sameCore
              .where('v.major', current.major)
              .where('v.minor', current.minor)
              .where('v.patch', current.patch)
          )
        }
      })
      .preload('version', (query) => query.preload('software'))
      .preload('platform')
      .preload('architecture')
      .orderBy('v.major', 'desc')
      .orderBy('v.minor', 'desc')
      .orderBy('v.patch', 'desc')
      .first()

    return update ?? null
  }

  async getLatest(platform: string, arch: string, channel: string, softwareSlug?: string) {
    const [software, platformRow, architectureRow] = await Promise.all([
      this.resolveSoftware(softwareSlug),
      Platform.findBy('name', platform),
      Architecture.findBy('name', arch),
    ])
    if (!platformRow || !architectureRow) return null

    return this.artifactRepository
      .publicQuery(software.id)
      .join('versions as v', 'v.id', 'artifacts.version_id')
      .where('artifacts.platform_id', platformRow.id)
      .where('artifacts.architecture_id', architectureRow.id)
      .where('artifacts.channel', channel)
      .preload('version', (query) => query.preload('software'))
      .preload('platform')
      .preload('architecture')
      .orderBy('v.major', 'desc')
      .orderBy('v.minor', 'desc')
      .orderBy('v.patch', 'desc')
      .first()
  }

  async getReleases(
    platform: string,
    arch: string,
    channel: string,
    limit = 20,
    page = 1,
    softwareSlug?: string
  ) {
    const [software, platformRow, architectureRow] = await Promise.all([
      this.resolveSoftware(softwareSlug),
      Platform.findBy('name', platform),
      Architecture.findBy('name', arch),
    ])

    if (!platformRow || !architectureRow) {
      throw new Error('Platform or architecture not supported.')
    }

    const query = this.artifactRepository
      .publicQuery(software.id)
      .join('versions as v', 'v.id', 'artifacts.version_id')
      .where('artifacts.platform_id', platformRow.id)
      .where('artifacts.architecture_id', architectureRow.id)
      .where('artifacts.channel', channel)
      .preload('version', (versionQuery) => versionQuery.preload('software'))
      .preload('platform')
      .preload('architecture')
      .orderBy('v.major', 'desc')
      .orderBy('v.minor', 'desc')
      .orderBy('v.patch', 'desc')
      .orderBy('artifacts.id', 'asc')

    // Lucid strips selected columns and ordering from the aggregate clone.
    // Keeping artifacts.* beside COUNT(*) is invalid on PostgreSQL.
    const paginated = await query.paginate(page, limit)
    const totalRecords = Number(paginated.total)
    const results = paginated.all()

    return {
      results,
      pagination: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit),
      },
    }
  }

  async recordAndStream(
    artifactId: string,
    ipAddress: string,
    userAgent?: string,
    softwareSlug?: string
  ) {
    const software = await this.resolveSoftware(softwareSlug)
    const artifact = await this.artifactRepository.findPublicById(artifactId, software.id)
    if (!artifact) throw new PublicArtifactNotFoundError('Public artifact not found.')
    if (!artifact.storageProvider) {
      throw new ArtifactStorageError('Artifact storage provider is unavailable.')
    }

    let stream: Readable
    try {
      stream = await StorageManager.resolve(artifact.storageProvider).getStream(artifact.storageKey)
    } catch (error) {
      throw new ArtifactStorageError('Artifact storage is temporarily unavailable.', {
        cause: error,
      })
    }

    stream.on('error', (error) => {
      logger.warn({ err: error, artifactId }, 'Artifact download stream failed')
    })

    try {
      await db.transaction(async (trx) => {
        await trx.from('artifacts').where('id', artifact.id).increment('download_count', 1)

        await DownloadHistory.create(
          {
            artifactId: artifact.id,
            ipAddress: isIP(ipAddress) ? ipAddress.slice(0, 50) : null,
            userAgent: userAgent?.slice(0, 2048) || null,
            lat: null,
            lng: null,
            countryCode: null,
          },
          { client: trx }
        )
      })
    } catch (error) {
      logger.warn(
        { err: error, artifactId: artifact.id },
        'Could not record artifact download metrics'
      )
    }

    return { artifact, stream }
  }
}

import { inject } from '@adonisjs/core'
import ArtifactRepository from '#repositories/artifact_repository'
import VersionRepository from '#repositories/version_repository'
import PlatformRepository from '#repositories/platform_repository'
import ArchitectureRepository from '#repositories/architecture_repository'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import StorageManager from '#services/storage/storage_manager'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { createReadStream } from 'node:fs'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import Artifact from '#models/artifact'
import StorageProvider from '#models/storage_provider'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

export function artifactDetailsDto(artifact: Artifact) {
  return {
    id: artifact.id,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    storageKey: artifact.storageKey,
    downloadCount: artifact.downloadCount,
    isArchived: artifact.isArchived,
    isPublished: artifact.isPublished,
    channel: artifact.channel,
    publishedAt: artifact.publishedAt,
    checksum: artifact.checksum,
    checksumMd5: artifact.checksumMd5,
    checksumSha1: artifact.checksumSha1,
    checksumSha256: artifact.checksumSha256,
    checksumSha512: artifact.checksumSha512,
    version: artifact.version
      ? {
          id: artifact.version.id,
          software: artifact.version.software
            ? { name: artifact.version.software.name, slug: artifact.version.software.slug }
            : null,
          major: artifact.version.major,
          minor: artifact.version.minor,
          patch: artifact.version.patch,
          codename: artifact.version.codename,
        }
      : null,
    platform: artifact.platform
      ? {
          id: artifact.platform.id,
          name: artifact.platform.name,
          displayName: artifact.platform.displayName,
        }
      : null,
    architecture: artifact.architecture
      ? {
          id: artifact.architecture.id,
          name: artifact.architecture.name,
          displayName: artifact.architecture.displayName,
        }
      : null,
    storageProvider: artifact.storageProvider
      ? {
          id: artifact.storageProvider.id,
          name: artifact.storageProvider.name,
          type: artifact.storageProvider.type,
        }
      : null,
  }
}

@inject()
export default class ArtifactService {
  constructor(
    protected artifactRepository: ArtifactRepository,
    protected versionRepository: VersionRepository,
    protected platformRepository: PlatformRepository,
    protected architectureRepository: ArchitectureRepository,
    protected storageProviderRepository: StorageProviderRepository
  ) {}

  private async computeChecksums(stream: NodeJS.ReadableStream) {
    const md5 = createHash('md5')
    const sha1 = createHash('sha1')
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')

    for await (const chunk of stream) {
      md5.update(chunk)
      sha1.update(chunk)
      sha256.update(chunk)
      sha512.update(chunk)
    }

    return {
      md5: md5.digest('hex'),
      sha1: sha1.digest('hex'),
      sha256: sha256.digest('hex'),
      sha512: sha512.digest('hex'),
    }
  }

  private assertUploadMetadata(data: Record<string, unknown>) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    for (const key of ['versionId', 'platformId', 'architectureId', 'storageProviderId']) {
      if (typeof data[key] !== 'string' || !uuid.test(data[key])) {
        throw new Error(`A valid ${key} is required.`)
      }
    }

    if (
      data.channel !== undefined &&
      data.channel !== '' &&
      !['dev', 'staging', 'beta', 'stable'].includes(String(data.channel))
    ) {
      throw new Error('Unsupported release channel.')
    }
  }

  private async reserveQuota(id: string, storageProviderId: string, sizeBytes: number) {
    await db.transaction(async (trx) => {
      const provider = await StorageProvider.query({ client: trx })
        .where('id', storageProviderId)
        .forUpdate()
        .firstOrFail()

      if (!provider.isActive) {
        throw new Error('The selected storage provider is not active.')
      }

      const now = DateTime.utc()
      const artifactsUsage = await trx
        .from('artifacts')
        .where('storage_provider_id', storageProviderId)
        .sum({ total: 'size_bytes' })
        .first()
      const reservationsUsage = await trx
        .from('storage_upload_reservations')
        .where('storage_provider_id', storageProviderId)
        .where('expires_at', '>', now.toJSDate())
        .sum({ total: 'size_bytes' })
        .first()
      const currentUsage =
        Number(artifactsUsage?.total || 0) + Number(reservationsUsage?.total || 0)
      const quota = Number(provider.quotaBytes || 0)

      if (quota > 0) {
        const usagePercent = (currentUsage / quota) * 100
        if (usagePercent >= 95) {
          throw new Error(
            `Storage quota exceeded (${usagePercent.toFixed(1)}%). Artifact upload blocked.`
          )
        }
        if (currentUsage + sizeBytes > quota) {
          throw new Error(
            `This file (${(sizeBytes / 1024 / 1024).toFixed(2)} MB) would exceed your remaining storage.`
          )
        }
      }

      await trx.table('storage_upload_reservations').insert({
        id,
        storage_provider_id: storageProviderId,
        size_bytes: sizeBytes,
        expires_at: now.plus({ days: 7 }).toJSDate(),
        created_at: now.toJSDate(),
      })
    })
  }

  /**
   * Retry cleanup for objects left behind if a process stopped after storage
   * accepted the bytes but before the database transaction completed. Keys
   * are derived from the reservation UUID, so this is safe to repeat.
   */
  private async cleanupExpiredReservations(
    storageProvider: StorageProvider,
    storage: ReturnType<typeof StorageManager.resolve>
  ) {
    const now = DateTime.utc().toJSDate()
    while (true) {
      const expired = await db
        .from('storage_upload_reservations')
        .where('storage_provider_id', storageProvider.id)
        .where('expires_at', '<=', now)
        .orderBy('expires_at', 'asc')
        .limit(100)

      if (expired.length === 0) return

      for (const reservation of expired) {
        await storage.delete(`artifacts/${reservation.id}/payload`)
      }

      await db.transaction(async (trx) => {
        await trx
          .from('storage_upload_reservations')
          .where('storage_provider_id', storageProvider.id)
          .whereIn(
            'id',
            expired.map((reservation) => reservation.id)
          )
          .where('expires_at', '<=', now)
          .delete()
      })
    }
  }

  private safeFilePart(value: string) {
    const safe = value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-')
    return safe.replace(/^-+|-+$/g, '').slice(0, 100) || 'release'
  }

  private buildFileName(
    softwareName: string,
    platformName: string,
    architectureName: string,
    version: { major: number; minor: number; patch: number; codename: string | null },
    extension: string
  ) {
    const versionString = `v${version.major}.${version.minor}.${version.patch}${version.codename ? `-${this.safeFilePart(version.codename)}` : ''}`
    return `${this.safeFilePart(softwareName)}_${this.safeFilePart(platformName)}_${this.safeFilePart(architectureName)}_${versionString}.${this.safeFilePart(extension)}`
  }

  async getIndexData(page: number, limit: number, filters: any) {
    const query = this.artifactRepository
      .query()
      .preload('version', (versionQuery) => versionQuery.preload('software'))
      .preload('platform')
      .preload('architecture')
      .orderBy('createdAt', 'desc')

    if (filters.fileName) {
      query.where('fileName', 'ilike', `%${filters.fileName}%`)
    }
    if (filters.softwareId) {
      query.whereHas('version', (versionQuery) =>
        versionQuery.where('softwareId', filters.softwareId)
      )
    }
    if (filters.versionId) {
      query.where('versionId', filters.versionId)
    }
    if (filters.platformId) {
      query.where('platformId', filters.platformId)
    }
    if (filters.architectureId) {
      query.where('architectureId', filters.architectureId)
    }

    const artifacts = await query.paginate(page, limit)

    const [versions, platforms, architectures] = await Promise.all([
      this.versionRepository
        .query()
        .preload('software')
        .orderBy('major', 'desc')
        .orderBy('minor', 'desc')
        .orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
    ])

    return { artifacts, versions, platforms, architectures }
  }

  async getCreateData() {
    const [versions, platforms, architectures, storageProviders] = await Promise.all([
      this.versionRepository
        .query()
        .whereHas('software', (softwareQuery) => softwareQuery.where('isActive', true))
        .preload('software')
        .orderBy('major', 'desc')
        .orderBy('minor', 'desc')
        .orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
      this.storageProviderRepository.query().where('isActive', true).orderBy('name', 'asc'),
    ])

    if (storageProviders.length === 0) {
      throw new Error(
        'No configured storage providers found. Please set up a storage provider before uploading artifacts.'
      )
    }

    const activeProvider = await StorageProvider.query().where('isDefault', true).first()
    let usagePercentage = 0

    if (activeProvider) {
      const usageResult = await db
        .from('artifacts')
        .where('storage_provider_id', activeProvider.id)
        .sum({ totalUsage: 'size_bytes' })
        .first()
      const currentUsage = Number(usageResult?.totalUsage || 0)
      const quota = Number(activeProvider.quotaBytes || 0)
      if (quota > 0) {
        usagePercentage = (currentUsage / quota) * 100
      }
    }

    if (usagePercentage >= 95) {
      throw new Error(
        `Storage quota is critical (${usagePercentage.toFixed(1)}%). Artifact upload is disabled.`
      )
    }

    return { versions, platforms, architectures, storageProviders, usagePercentage }
  }

  async uploadArtifact(file: MultipartFile, data: any) {
    this.assertUploadMetadata(data)
    if (!file.tmpPath || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('The uploaded file is empty or unavailable.')
    }

    const version = await this.versionRepository.findById(data.versionId)
    const platform = await this.platformRepository.findById(data.platformId)
    const architecture = await this.architectureRepository.findById(data.architectureId)
    const storageProvider = await this.storageProviderRepository.findById(data.storageProviderId)

    if (!storageProvider.isActive) {
      throw new Error('The selected storage provider is not active or completely configured.')
    }

    // Platform & Architecture Validation
    if (platform.name.toLowerCase() === 'android') {
      if (
        architecture.name.toLowerCase().includes('x86') ||
        architecture.name.toLowerCase().includes('x64')
      ) {
        throw new Error('Android does not support x86 or x64 architecture in this configuration.')
      }
    }

    // Extension Validation
    const ext = (file.extname || file.clientName.split('.').pop() || '').toLowerCase()
    const pName = platform.name.toLowerCase()

    let isExtValid = true
    if (pName.includes('windows')) {
      isExtValid = ['exe', 'zip', 'msi', 'nupkg'].includes(ext)
    } else if (pName.includes('mac')) {
      isExtValid = ['dmg', 'pkg', 'zip', 'app'].includes(ext)
    } else if (pName === 'android') {
      isExtValid = ['apk', 'aab'].includes(ext)
    } else if (
      ['linux', 'ubuntu', 'debian', 'linux_mint', 'fedora', 'rhel', 'centos', 'opensuse'].includes(
        pName
      )
    ) {
      isExtValid = ['appimage', 'deb', 'rpm', 'tar', 'gz', 'zip'].includes(ext)
    }

    if (!isExtValid) {
      throw new Error(`Invalid file extension (.${ext}) for platform ${platform.displayName}.`)
    }

    if (!version.software?.isActive) {
      throw new Error('Cannot upload an artifact for inactive software.')
    }
    const fileName = this.buildFileName(
      version.software.name,
      platform.name,
      architecture.name,
      version,
      ext
    )
    const artifactId = randomUUID()
    const storageKey = `artifacts/${artifactId}/payload`
    const storage = StorageManager.resolve(storageProvider)
    await this.cleanupExpiredReservations(storageProvider, storage)
    await this.reserveQuota(artifactId, storageProvider.id, file.size)

    let objectStored = false
    try {
      const hashes = await this.computeChecksums(createReadStream(file.tmpPath))
      const uploadResult = await storage.upload(createReadStream(file.tmpPath), {
        fileName,
        key: storageKey,
        contentType: 'application/octet-stream',
        contentLength: file.size,
      })
      objectStored = true

      if (uploadResult.key !== storageKey) {
        throw new Error('Storage provider changed the assigned object key.')
      }

      const isPublished = data.isPublished === 'on' || data.isPublished === true
      return await db.transaction(async (trx) => {
        const artifact = await Artifact.create(
          {
            id: artifactId,
            fileName,
            versionId: version.id,
            platformId: platform.id,
            architectureId: architecture.id,
            storageKey,
            storageProviderId: storageProvider.id,
            sizeBytes: file.size,
            mimeType: 'application/octet-stream',
            isArchived: false,
            channel: data.channel || 'dev',
            isPublished,
            publishedAt: isPublished ? DateTime.now() : null,
            checksum: hashes.sha256,
            checksumMd5: hashes.md5,
            checksumSha1: hashes.sha1,
            checksumSha256: hashes.sha256,
            checksumSha512: hashes.sha512,
          },
          { client: trx }
        )
        await trx.from('storage_upload_reservations').where('id', artifactId).delete()
        return artifact
      })
    } catch (error) {
      let cleanupSucceeded = !objectStored
      if (objectStored) {
        try {
          await storage.delete(storageKey)
          cleanupSucceeded = true
        } catch (cleanupError) {
          logger.error(
            { err: cleanupError, storageProviderId: storageProvider.id, storageKey },
            'Failed to compensate artifact upload'
          )
        }
      }

      if (cleanupSucceeded) {
        await db
          .from('storage_upload_reservations')
          .where('id', artifactId)
          .delete()
          .catch(() => {})
      }
      throw error
    }
  }

  async getEditData(id: string | number) {
    const artifact = await Artifact.findOrFail(id)
    const [versions, platforms, architectures] = await Promise.all([
      this.versionRepository
        .query()
        .preload('software')
        .orderBy('major', 'desc')
        .orderBy('minor', 'desc')
        .orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
    ])
    return { artifact, versions, platforms, architectures }
  }

  async updateArtifact(id: string | number, data: any) {
    this.assertUploadMetadata({
      ...data,
      storageProviderId: data.storageProviderId || '00000000-0000-4000-8000-000000000000',
    })
    if (!['dev', 'staging', 'beta', 'stable'].includes(data.channel)) {
      throw new Error('Unsupported release channel.')
    }
    const artifact = await Artifact.findOrFail(id)

    const [version, platform, architecture] = await Promise.all([
      this.versionRepository.findById(data.versionId),
      this.platformRepository.findById(data.platformId),
      this.architectureRepository.findById(data.architectureId),
    ])

    if (platform.name.toLowerCase() === 'android') {
      if (
        architecture.name.toLowerCase().includes('x86') ||
        architecture.name.toLowerCase().includes('x64')
      ) {
        throw new Error('Android does not support x86 or x64 architecture.')
      }
    }

    const ext = artifact.fileName.split('.').pop()
    if (!version.software?.isActive) {
      throw new Error('Cannot assign an artifact to inactive software.')
    }
    const newFileName = this.buildFileName(
      version.software.name,
      platform.name,
      architecture.name,
      version,
      ext || 'bin'
    )

    artifact.merge({
      versionId: data.versionId,
      platformId: data.platformId,
      architectureId: data.architectureId,
      isArchived: data.isArchived === 'on' || data.isArchived === true,
      fileName: newFileName,
      channel: data.channel,
    })

    await artifact.save()
    return { artifact, newFileName }
  }

  async deleteArtifact(id: string | number) {
    const artifact = await Artifact.findOrFail(id)
    await artifact.delete()
    return artifact
  }

  async publishArtifact(id: string | number) {
    const artifact = await Artifact.findOrFail(id)

    if (artifact.isPublished) {
      throw new Error('Artifact is already published.')
    }

    artifact.isPublished = true
    if (artifact.isArchived) {
      throw new Error('Archived artifacts cannot be published. Unarchive the artifact first.')
    }
    artifact.publishedAt = DateTime.now()
    await artifact.save()
    return artifact
  }

  async getDetails(id: string | number, page: number) {
    const artifact = await this.artifactRepository
      .query()
      .where('id', id)
      .preload('version', (versionQuery) => versionQuery.preload('software'))
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')
      .firstOrFail()

    const downloadHistoryModule = await import('#models/download_history')
    const DownloadHistory = downloadHistoryModule.default
    const history = await DownloadHistory.query()
      .where('artifactId', artifact.id)
      .orderBy('createdAt', 'desc')
      .paginate(page, 10)

    return { artifact, history }
  }

  async rebuildAllNames() {
    const artifacts = await this.artifactRepository
      .query()
      .preload('version', (versionQuery) => versionQuery.preload('software'))
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')

    let updatedCount = 0

    for (const artifact of artifacts) {
      const v = artifact.version
      const ext = artifact.fileName.split('.').pop()
      const newFileName = this.buildFileName(
        v.software.name,
        artifact.platform.name,
        artifact.architecture.name,
        v,
        ext || 'bin'
      )

      let needsSave = false

      if (artifact.fileName !== newFileName) {
        artifact.fileName = newFileName
        needsSave = true
      }

      try {
        const storage = StorageManager.resolve(artifact.storageProvider)
        const stream = await storage.getStream(artifact.storageKey)
        const hashes = await this.computeChecksums(stream)

        artifact.checksumMd5 = hashes.md5
        artifact.checksumSha1 = hashes.sha1
        artifact.checksumSha256 = hashes.sha256
        artifact.checksumSha512 = hashes.sha512
        artifact.checksum = hashes.sha256
        needsSave = true
      } catch (err) {
        console.error(`Failed to recalculate checksums for artifact ${artifact.id}:`, err)
      }

      if (needsSave) {
        await artifact.save()
        updatedCount++
      }
    }

    return updatedCount
  }
}

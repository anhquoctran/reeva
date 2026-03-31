import { inject } from '@adonisjs/core'
import ArtifactRepository from '#repositories/artifact_repository'
import VersionRepository from '#repositories/version_repository'
import PlatformRepository from '#repositories/platform_repository'
import ArchitectureRepository from '#repositories/architecture_repository'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import SettingRepository from '#repositories/setting_repository'
import StorageManager from '#services/storage/storage_manager'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import fs from 'node:fs/promises'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import Artifact from '#models/artifact'
import StorageProvider from '#models/storage_provider'

@inject()
export default class ArtifactService {
  constructor(
    protected artifactRepository: ArtifactRepository,
    protected versionRepository: VersionRepository,
    protected platformRepository: PlatformRepository,
    protected architectureRepository: ArchitectureRepository,
    protected storageProviderRepository: StorageProviderRepository,
    protected settingRepository: SettingRepository
  ) {}

  private async computeChecksums(stream: NodeJS.ReadableStream) {
    const md5 = createHash('md5')
    const sha1 = createHash('sha1')
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')

    return new Promise<{ md5: string; sha1: string; sha256: string; sha512: string }>(
      (resolve, reject) => {
        stream.on('data', (chunk) => {
          md5.update(chunk)
          sha1.update(chunk)
          sha256.update(chunk)
          sha512.update(chunk)
        })
        stream.on('end', () => {
          resolve({
            md5: md5.digest('hex'),
            sha1: sha1.digest('hex'),
            sha256: sha256.digest('hex'),
            sha512: sha512.digest('hex'),
          })
        })
        stream.on('error', reject)
      }
    )
  }

  private async getAppName() {
    const appNameSetting = await this.settingRepository.findByKey('appName')
    return appNameSetting?.value || 'reeva'
  }

  async getIndexData(page: number, limit: number, filters: any) {
    const query = this.artifactRepository.query()
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .orderBy('createdAt', 'desc')

    if (filters.fileName) {
      query.where('fileName', 'like', `%${filters.fileName}%`)
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
      this.versionRepository.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
    ])

    return { artifacts, versions, platforms, architectures }
  }

  async getCreateData() {
    const [versions, platforms, architectures, storageProviders] = await Promise.all([
      this.versionRepository.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
      this.storageProviderRepository.query().where('isActive', true).orderBy('name', 'asc'),
    ])

    if (storageProviders.length === 0) {
      throw new Error('No configured storage providers found. Please set up a storage provider before uploading artifacts.')
    }

    const activeProvider = await StorageProvider.query().where('isDefault', true).first()
    let usagePercentage = 0

    if (activeProvider) {
      const usageResult = await this.artifactRepository.query()
        .where('storage_provider_id', activeProvider.id)
        .sum('size_bytes as totalUsage')
        .first()
      const currentUsage = Number(usageResult?.$extras.totalUsage || 0)
      const quota = Number(activeProvider.quotaBytes || 0)
      if (quota > 0) {
        usagePercentage = (currentUsage / quota) * 100
      }
    }

    if (usagePercentage >= 95) {
      throw new Error(`Storage quota is critical (${usagePercentage.toFixed(1)}%). Artifact upload is disabled.`)
    }

    return { versions, platforms, architectures, storageProviders, usagePercentage }
  }

  async uploadArtifact(file: MultipartFile, data: any) {
    const version = await this.versionRepository.findById(data.versionId)
    const platform = await this.platformRepository.findById(data.platformId)
    const architecture = await this.architectureRepository.findById(data.architectureId)
    const storageProvider = await this.storageProviderRepository.findById(data.storageProviderId)

    if (!storageProvider.isActive) {
      throw new Error('The selected storage provider is not active or completely configured.')
    }

    // Platform & Architecture Validation
    if (platform.name.toLowerCase() === 'android') {
      if (architecture.name.toLowerCase().includes('x86') || architecture.name.toLowerCase().includes('x64')) {
        throw new Error('Android does not support x86 or x64 architecture in this configuration.')
      }
    }

    // Extension Validation
    const ext = file.extname || file.clientName.split('.').pop()?.toLowerCase() || ''
    const pName = platform.name.toLowerCase()

    let isExtValid = true
    if (pName.includes('windows')) {
      isExtValid = ['exe', 'zip', 'msi', 'nupkg'].includes(ext)
    } else if (pName.includes('mac')) {
      isExtValid = ['dmg', 'pkg', 'zip', 'app'].includes(ext)
    } else if (pName === 'android') {
      isExtValid = ['apk', 'aab'].includes(ext)
    }

    if (!isExtValid) {
      throw new Error(`Invalid file extension (.${ext}) for platform ${platform.displayName}.`)
    }

    // Quota validation
    const usageResult = await this.artifactRepository.query()
      .where('storage_provider_id', storageProvider.id)
      .sum('size_bytes as totalUsage')
      .first()
    const currentUsage = Number(usageResult?.$extras.totalUsage || 0)
    const quota = Number(storageProvider.quotaBytes || 0)

    if (quota > 0) {
      const usagePercent = (currentUsage / quota) * 100
      if (usagePercent >= 95) {
        throw new Error(`Storage quota exceeded (${usagePercent.toFixed(1)}%). Artifact upload blocked.`)
      }
      if (currentUsage + file.size > quota) {
        throw new Error(`This file (${(file.size / 1024 / 1024).toFixed(2)} MB) would exceed your remaining storage.`)
      }
    }

    const appName = await this.getAppName()
    const versionString = `v${version.major}.${version.minor}.${version.patch}${version.codename ? `-${version.codename}` : ''}`
    const fileName = `${appName}_${platform.name}_${architecture.name}_${versionString}.${ext}`
    let storageKey = `artifacts/${platform.name}/${architecture.name}/${versionString}/${fileName}`

    const storage = StorageManager.resolve(storageProvider)
    const buffer = await fs.readFile(file.tmpPath!)

    const uploadResult = await storage.upload(buffer, {
      fileName,
      key: storageKey,
      contentType: file.headers['content-type'] || 'application/octet-stream',
    })

    if (uploadResult && uploadResult.key) {
      storageKey = uploadResult.key
    }

    const { Readable } = await import('node:stream')
    const hashes = await this.computeChecksums(Readable.from(buffer))
    const isPublished = data.isPublished === 'on' || data.isPublished === true

    return await Artifact.create({
      fileName,
      versionId: version.id,
      platformId: platform.id,
      architectureId: architecture.id,
      storageKey,
      storageProviderId: storageProvider.id,
      sizeBytes: file.size,
      mimeType: file.headers['content-type'] || 'application/octet-stream',
      isArchived: false,
      channel: data.channel || 'dev',
      isPublished,
      publishedAt: isPublished ? DateTime.now() : null,
      checksum: hashes.sha256,
      checksumMd5: hashes.md5,
      checksumSha1: hashes.sha1,
      checksumSha256: hashes.sha256,
      checksumSha512: hashes.sha512,
    })
  }

  async getEditData(id: string | number) {
    const artifact = await Artifact.findOrFail(id)
    const [versions, platforms, architectures] = await Promise.all([
      this.versionRepository.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      this.platformRepository.query().orderBy('name', 'asc'),
      this.architectureRepository.query().orderBy('name', 'asc'),
    ])
    return { artifact, versions, platforms, architectures }
  }

  async updateArtifact(id: string | number, data: any) {
    const artifact = await Artifact.findOrFail(id)

    const [version, platform, architecture] = await Promise.all([
      this.versionRepository.findById(data.versionId),
      this.platformRepository.findById(data.platformId),
      this.architectureRepository.findById(data.architectureId),
    ])

    if (platform.name.toLowerCase() === 'android') {
      if (architecture.name.toLowerCase().includes('x86') || architecture.name.toLowerCase().includes('x64')) {
        throw new Error('Android does not support x86 or x64 architecture.')
      }
    }

    const appName = await this.getAppName()
    const versionStr = `v${version.major}.${version.minor}.${version.patch}${version.codename ? `-${version.codename}` : ''}`
    const ext = artifact.fileName.split('.').pop()
    const newFileName = `${appName}_${platform.name}_${architecture.name}_${versionStr}.${ext}`

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
    artifact.publishedAt = DateTime.now()
    await artifact.save()
    return artifact
  }

  async getDetails(id: string | number, page: number) {
    const artifact = await this.artifactRepository.query()
      .where('id', id)
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')
      .firstOrFail()

    const DownloadHistory = (await import('#models/download_history')).default
    const history = await DownloadHistory.query()
      .where('artifactId', artifact.id)
      .orderBy('createdAt', 'desc')
      .paginate(page, 10)

    return { artifact, history }
  }

  async rebuildAllNames() {
    const appName = await this.getAppName()
    const artifacts = await this.artifactRepository.query()
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')

    let updatedCount = 0

    for (const artifact of artifacts) {
      const v = artifact.version
      const versionStr = `v${v.major}.${v.minor}.${v.patch}${v.codename ? `-${v.codename}` : ''}`
      const ext = artifact.fileName.split('.').pop()
      const newFileName = `${appName}_${artifact.platform.name}_${artifact.architecture.name}_${versionStr}.${ext}`

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

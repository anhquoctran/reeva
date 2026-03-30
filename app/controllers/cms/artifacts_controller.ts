import Artifact from '#models/artifact'
import Version from '#models/version'
import Platform from '#models/platform'
import Architecture from '#models/architecture'
import StorageProvider from '#models/storage_provider'
import Setting from '#models/setting'
import StorageManager from '#services/storage/storage_manager'
import fs from 'node:fs/promises'
import DownloadHistory from '#models/download_history'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'

export default class ArtifactsController {
  /**
   * Returns artifact details and paginated download history as JSON.
   */
  async details({ params, request, response }: HttpContext) {
    const page = request.input('page', 1)
    const artifact = await Artifact.query()
      .where('id', params.id)
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')
      .firstOrFail()

    const history = await DownloadHistory.query()
      .where('artifactId', artifact.id)
      .orderBy('createdAt', 'desc')
      .paginate(page, 10)

    return response.json({
      artifact,
      history: history.toJSON()
    })
  }

  /**
   * Helper to compute multiple checksums from a stream.
   */
  private async computeChecksums(stream: NodeJS.ReadableStream) {
    const md5 = createHash('md5')
    const sha1 = createHash('sha1')
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')

    return new Promise<{ md5: string; sha1: string; sha256: string; sha512: string }>((resolve, reject) => {
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
    })
  }

  /**
   * Rebuilds ALL artifact filenames and recalculates checksums based on current metadata and app settings.
   */
  async rebuildAllNames({ response, session }: HttpContext) {
    const artifacts = await Artifact.query()
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')

    const appNameSetting = await Setting.findBy('key', 'appName')
    const appName = appNameSetting?.value || 'reeva'

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

      // Sync and recalculate checksums (Always sync to be sure they are correct)
      try {
        const storage = StorageManager.resolve(artifact.storageProvider)
        const stream = await storage.getStream(artifact.storageKey)
        const hashes = await this.computeChecksums(stream)
        
        artifact.checksumMd5 = hashes.md5
        artifact.checksumSha1 = hashes.sha1
        artifact.checksumSha256 = hashes.sha256
        artifact.checksumSha512 = hashes.sha512
        
        // Also sync the legacy 'checksum' column with SHA-256 for backward compatibility
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

    session.flash('success', `Successfully synchronized ${updatedCount} artifacts (filenames and multi-algorithm checksums).`)
    return response.redirect().back()
  }

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10

    const filters = {
      fileName: request.input('fileName'),
      versionId: request.input('versionId'),
      platformId: request.input('platformId'),
      architectureId: request.input('architectureId'),
    }

    const query = Artifact.query()
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
    artifacts.baseUrl(request.url())
    artifacts.queryString(request.qs())

    const [versions, platforms, architectures] = await Promise.all([
      Version.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      Platform.query().orderBy('name', 'asc'),
      Architecture.query().orderBy('name', 'asc'),
    ])

    return view.render('pages/cms/artifacts/index', {
      artifacts,
      filters,
      versions,
      platforms,
      architectures,
    })
  }

  async create({ view, response, session }: HttpContext) {
    const [versions, platforms, architectures, storageProviders] = await Promise.all([
      Version.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      Platform.query().orderBy('name', 'asc'),
      Architecture.query().orderBy('name', 'asc'),
      StorageProvider.query().where('isActive', true).orderBy('name', 'asc'),
    ])

    if (storageProviders.length === 0) {
      session.flash('error', 'No configured storage providers found. Please set up a storage provider before uploading artifacts.')
      return response.redirect().toRoute('cms.artifacts.index')
    }

    // Check disk quota for the default/active provider
    const activeProvider = await StorageProvider.query().where('isDefault', true).first()
    let usagePercentage = 0
    if (activeProvider) {
      const usageResult = await Artifact.query()
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
      session.flash('error', `Storage quota is critical (${usagePercentage.toFixed(1)}%). Artifact upload is disabled.`)
      return response.redirect().toRoute('cms.artifacts.index')
    }

    return view.render('pages/cms/artifacts/create', { versions, platforms, architectures, storageProviders, usagePercentage })
  }

  async store({ request, response, session }: HttpContext) {
    const file = request.file('file')

    if (!file) {
      session.flash('errors.file', 'Artifact file is required.')
      return response.redirect().back()
    }

    if (!file.isValid) {
      session.flash('errors.file', file.errors.map(e => e.message).join(', '))
      return response.redirect().back()
    }

    const data = request.all()
    
    const version = await Version.findOrFail(data.versionId)
    const platform = await Platform.findOrFail(data.platformId)
    const architecture = await Architecture.findOrFail(data.architectureId)
    const storageProvider = await StorageProvider.findOrFail(data.storageProviderId)

    if (!storageProvider.isActive) {
      session.flash('error', 'The selected storage provider is not active or completely configured.')
      return response.redirect().back()
    }

    // Platform & Architecture Validation
    if (platform.name.toLowerCase() === 'android') {
      if (architecture.name.toLowerCase().includes('x86') || architecture.name.toLowerCase().includes('x64')) {
        session.flash('errors.architectureId', 'Android does not support x86 or x64 architecture in this configuration.')
        return response.redirect().back()
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
      session.flash('errors.file', `Invalid file extension (.${ext}) for platform ${platform.displayName}.`)
      return response.redirect().back()
    }

    // Quota validation
    const usageResult = await Artifact.query()
      .where('storage_provider_id', storageProvider.id)
      .sum('size_bytes as totalUsage')
      .first()
    const currentUsage = Number(usageResult?.$extras.totalUsage || 0)
    const quota = Number(storageProvider.quotaBytes || 0)
    
    // Block if current usage is already at 95% OR current + new file would hit 100%
    if (quota > 0) {
      const usagePercent = (currentUsage / quota) * 100
      if (usagePercent >= 95) {
         session.flash('error', `Storage quota exceeded (${usagePercent.toFixed(1)}%). Artifact upload blocked.`)
         return response.redirect().back()
      }
      
      if (currentUsage + file.size > quota) {
         session.flash('error', `This file (${(file.size / 1024 / 1024).toFixed(2)} MB) would exceed your remaining storage.`)
         return response.redirect().back()
      }
    }

    const appNameSetting = await Setting.findBy('key', 'appName')
    const appName = appNameSetting?.value || 'reeva'

    const versionString = `v${version.major}.${version.minor}.${version.patch}${version.codename ? `-${version.codename}` : ''}`
    const fileName = `${appName}_${platform.name}_${architecture.name}_${versionString}.${ext}`

    let storageKey = `artifacts/${platform.name}/${architecture.name}/${versionString}/${fileName}`

    const storage = StorageManager.resolve(storageProvider)
    const buffer = await fs.readFile(file.tmpPath!)
    
    // Upload the file buffer
    const uploadResult = await storage.upload(buffer, {
      fileName,
      key: storageKey,
      contentType: file.headers['content-type'] || 'application/octet-stream' // fall back if empty
    })

    if (uploadResult && uploadResult.key) {
      storageKey = uploadResult.key
    }

    // Compute checksums for the new artifact
    const { Readable } = await import('node:stream')
    const hashes = await this.computeChecksums(Readable.from(buffer))

    const isPublished = data.isPublished === 'on' || data.isPublished === true

    await Artifact.create({
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
      isPublished: isPublished,
      publishedAt: isPublished ? DateTime.now() : null,
      checksum: hashes.sha256, // Legacy SHA-256
      checksumMd5: hashes.md5,
      checksumSha1: hashes.sha1,
      checksumSha256: hashes.sha256,
      checksumSha512: hashes.sha512,
    })

    session.flash('success', 'Artifact uploaded successfully.')
    return response.redirect().toRoute('cms.artifacts.index')
  }

  async edit({ params, view }: HttpContext) {
    const artifact = await Artifact.findOrFail(params.id)
    const [versions, platforms, architectures] = await Promise.all([
      Version.query().orderBy('major', 'desc').orderBy('minor', 'desc').orderBy('patch', 'desc'),
      Platform.query().orderBy('name', 'asc'),
      Architecture.query().orderBy('name', 'asc'),
    ])
    return view.render('pages/cms/artifacts/edit', { artifact, versions, platforms, architectures })
  }

  async update({ params, request, response, session }: HttpContext) {
    const artifact = await Artifact.findOrFail(params.id)
    const data = request.all()

    const [version, platform, architecture] = await Promise.all([
      Version.findOrFail(data.versionId),
      Platform.findOrFail(data.platformId),
      Architecture.findOrFail(data.architectureId),
    ])

    // Platform & Architecture Validation
    if (platform.name.toLowerCase() === 'android') {
      if (architecture.name.toLowerCase().includes('x86') || architecture.name.toLowerCase().includes('x64')) {
        session.flash('error', 'Android does not support x86 or x64 architecture.')
        return response.redirect().back()
      }
    }

    const appNameSetting = await Setting.findBy('key', 'appName')
    const appName = appNameSetting?.value || 'reeva'

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

    session.flash('success', `Artifact updated and filename synchronized: ${newFileName}`)
    return response.redirect().toRoute('cms.artifacts.index')
  }

  async destroy({ params, response, session }: HttpContext) {
    const artifact = await Artifact.findOrFail(params.id)
    await artifact.delete()

    session.flash('success', 'Artifact deleted successfully.')
    return response.redirect().toRoute('cms.artifacts.index')
  }

  async publish({ params, response, session }: HttpContext) {
    const artifact = await Artifact.findOrFail(params.id)
    
    if (artifact.isPublished) {
       session.flash('info', 'Artifact is already published.')
       return response.redirect().back()
    }

    artifact.isPublished = true
    artifact.publishedAt = DateTime.now()
    await artifact.save()

    session.flash('success', `Artifact ${artifact.fileName} has been published and is now visible to the API.`)
    return response.redirect().back()
  }
}
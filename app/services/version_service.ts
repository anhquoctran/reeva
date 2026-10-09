import { inject } from '@adonisjs/core'
import VersionRepository from '#repositories/version_repository'
import ArtifactRepository from '#repositories/artifact_repository'
import semver from 'semver'
import { DateTime } from 'luxon'
import SoftwareRepository from '#repositories/software_repository'
import Artifact from '#models/artifact'

@inject()
export default class VersionService {
  constructor(
    protected versionRepository: VersionRepository,
    protected artifactRepository: ArtifactRepository,
    protected softwareRepository: SoftwareRepository
  ) {}

  private parseSemverFilter(query: any, input: string) {
    const semverRegex = /^([<>]=?|==)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(\*)?$/
    const match = input.trim().match(semverRegex)

    if (!match) throw new Error('Invalid semantic version filter.')

    const operator = match[1] || '=='
    const major = match[2]
    const minor = match[3] || '0'
    const patch = match[4] || '0'
    const wildcard = match[5]
    const maj = Number.parseInt(major)
    const min = Number.parseInt(minor)
    const pat = Number.parseInt(patch)

    // Keep filter parts within the range accepted by version creation and
    // prevent oversized numeric input from becoming Infinity or an invalid
    // database binding. A wildcard is an equality-style UI filter only.
    if (
      [major, match[3], match[4]].some((part) => part !== undefined && part.length > 9) ||
      ![maj, min, pat].every(Number.isSafeInteger) ||
      (wildcard && operator !== '==')
    ) {
      throw new Error('Invalid semantic version filter.')
    }

    if (wildcard) {
      query.where('major', maj)
      if (match[3]) query.where('minor', min)
      return
    }

    switch (operator) {
      case '>=':
        query.where((q: any) => {
          q.where('major', '>', maj)
            .orWhere((sq: any) => sq.where('major', maj).where('minor', '>', min))
            .orWhere((sq: any) =>
              sq.where('major', maj).where('minor', min).where('patch', '>=', pat)
            )
        })
        break
      case '>':
        query.where((q: any) => {
          q.where('major', '>', maj)
            .orWhere((sq: any) => sq.where('major', maj).where('minor', '>', min))
            .orWhere((sq: any) =>
              sq.where('major', maj).where('minor', min).where('patch', '>', pat)
            )
        })
        break
      case '<=':
        query.where((q: any) => {
          q.where('major', '<', maj)
            .orWhere((sq: any) => sq.where('major', maj).where('minor', '<', min))
            .orWhere((sq: any) =>
              sq.where('major', maj).where('minor', min).where('patch', '<=', pat)
            )
        })
        break
      case '<':
        query.where((q: any) => {
          q.where('major', '<', maj)
            .orWhere((sq: any) => sq.where('major', maj).where('minor', '<', min))
            .orWhere((sq: any) =>
              sq.where('major', maj).where('minor', min).where('patch', '<', pat)
            )
        })
        break
      default:
        query.where('major', maj).where('minor', min).where('patch', pat)
    }
  }

  async getFilteredVersions(page: number, limit: number, filters: any) {
    if (typeof filters.softwareId !== 'string') {
      throw new Error('A software product is required.')
    }
    const query = this.versionRepository
      .query()
      .where('softwareId', filters.softwareId)
      .orderBy('createdAt', 'desc')

    if (filters.versionNumber) {
      if (typeof filters.versionNumber !== 'string' || filters.versionNumber.length > 50) {
        throw new Error('Invalid semantic version filter.')
      }
      this.parseSemverFilter(query, filters.versionNumber)
    }

    if (filters.codename) {
      if (typeof filters.codename !== 'string' || filters.codename.length > 100) {
        throw new Error('Codename filter must be 100 characters or fewer.')
      }
      query.whereRaw('LOWER(codename) LIKE ?', [`%${filters.codename.toLowerCase()}%`])
    }

    if (filters.isActive !== undefined && filters.isActive !== '') {
      query.where('isActive', filters.isActive === '1' || filters.isActive === true)
    }

    if (filters.dateFrom) {
      if (typeof filters.dateFrom !== 'string' || !DateTime.fromISO(filters.dateFrom).isValid) {
        throw new Error('Invalid start date.')
      }
      const sqlDate = DateTime.fromISO(filters.dateFrom).startOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '>=', sqlDate)
    }

    if (filters.dateTo) {
      if (typeof filters.dateTo !== 'string' || !DateTime.fromISO(filters.dateTo).isValid) {
        throw new Error('Invalid end date.')
      }
      const sqlDate = DateTime.fromISO(filters.dateTo).endOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '<=', sqlDate)
    }

    return await query.paginate(page, limit)
  }

  async validateAndCheckDuplicate(
    vString: string,
    major: number,
    minor: number,
    patch: number,
    softwareId: string,
    excludeId?: number | string
  ) {
    if (!semver.valid(vString)) {
      throw new Error(`Invalid semantic version number: ${vString}.`)
    }

    const q = this.versionRepository
      .query()
      .where('major', major)
      .where('minor', minor)
      .where('patch', patch)
      .where('softwareId', softwareId)

    if (excludeId) {
      q.whereNot('id', excludeId)
    }

    const existing = await q.first()
    if (existing) {
      throw new Error(`Version ${vString} already exists.`)
    }
  }

  async createVersion(data: any) {
    if (typeof data.softwareId !== 'string') throw new Error('A software product is required.')
    const software = await this.softwareRepository.findById(data.softwareId)
    if (!software.isActive) throw new Error('Cannot add versions to inactive software.')
    const { major, minor, patch } = this.parseVersionParts(data)
    const vString = `${major}.${minor}.${patch}`

    await this.validateAndCheckDuplicate(vString, major, minor, patch, software.id)

    return await this.versionRepository.create({
      major,
      minor,
      patch,
      softwareId: software.id,
      codename: this.parseCodename(data.codename),
      changelog: this.parseChangelog(data.changelogs || data.changelog),
      isActive: data.isActive === 'on',
      releaseDate: this.parseReleaseDate(data.releaseDate),
    })
  }

  async getVersion(id: string | number) {
    return await this.versionRepository.findById(id)
  }

  async updateVersion(id: string | number, data: any) {
    const version = await this.versionRepository.findById(id)
    const { major, minor, patch } = this.parseVersionParts(data)
    const vString = `${major}.${minor}.${patch}`

    await this.validateAndCheckDuplicate(
      vString,
      major,
      minor,
      patch,
      version.softwareId,
      version.id
    )

    const nextCodename = this.parseCodename(data.codename)
    const nextChangelog = this.parseChangelog(data.changelogs || data.changelog)
    const signedMetadataChanged =
      version.major !== major ||
      version.minor !== minor ||
      version.patch !== patch ||
      version.codename !== nextCodename ||
      version.changelog !== nextChangelog

    version.merge({
      major,
      minor,
      patch,
      codename: nextCodename,
      changelog: nextChangelog,
      isActive: data.isActive === 'on' || data.isActive === true,
      releaseDate: this.parseReleaseDate(data.releaseDate),
    })

    const updatedVersion = await this.versionRepository.update(version)
    if (signedMetadataChanged) {
      await Artifact.query()
        .where('versionId', version.id)
        .update({ signature: null, signatureKeyId: null, signatureManifest: null })
    }
    return updatedVersion
  }

  async toggleVersion(id: string | number) {
    const version = await this.versionRepository.findById(id)
    version.isActive = !version.isActive
    return await this.versionRepository.update(version)
  }

  async deleteVersion(id: string | number) {
    const version = await this.versionRepository.findById(id)

    const hasArtifacts = await this.artifactRepository.findByVersionId(version.id)
    if (hasArtifacts) {
      throw new Error(
        'Cannot delete version because it has associated artifacts. Delete the artifacts first.'
      )
    }

    await this.versionRepository.delete(version)
    return version
  }

  private parseVersionParts(data: any) {
    const parsePart = (value: unknown) => {
      if (typeof value !== 'string' && typeof value !== 'number') return null
      const text = String(value)
      if (!/^\d{1,9}$/.test(text)) return null
      const number = Number(text)
      return Number.isSafeInteger(number) ? number : null
    }
    const major = parsePart(data.major)
    const minor = parsePart(data.minor)
    const patch = parsePart(data.patch)
    if (major === null || minor === null || patch === null) {
      throw new Error('Version parts must be non-negative whole numbers with at most nine digits.')
    }
    return { major, minor, patch }
  }

  private parseCodename(value: unknown) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.length > 100) {
      throw new Error('Codename must be 100 characters or fewer.')
    }
    return value.trim() || null
  }

  private parseChangelog(value: unknown) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.length > 20_000) {
      throw new Error('Changelog must be 20,000 characters or fewer.')
    }
    return value
  }

  private parseReleaseDate(value: unknown) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw new Error('Release date is invalid.')
    const releaseDate = DateTime.fromISO(value)
    if (!releaseDate.isValid || releaseDate.toISODate() !== value) {
      throw new Error('Release date must use YYYY-MM-DD format.')
    }
    return releaseDate
  }
}

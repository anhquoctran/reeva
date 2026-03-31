import { inject } from '@adonisjs/core'
import VersionRepository from '#repositories/version_repository'
import ArtifactRepository from '#repositories/artifact_repository'
import semver from 'semver'
import { DateTime } from 'luxon'

@inject()
export default class VersionService {
  constructor(
    protected versionRepository: VersionRepository,
    protected artifactRepository: ArtifactRepository
  ) {}

  private parseSemverFilter(query: any, input: string) {
    const semverRegex = /^([<>]=?|==)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(\*)?$/
    const match = input.trim().match(semverRegex)

    if (!match) return

    const [_, operator = '==', major, minor = '0', patch = '0', wildcard] = match
    const maj = Number.parseInt(major)
    const min = Number.parseInt(minor)
    const pat = Number.parseInt(patch)

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
           .orWhere((sq: any) => sq.where('major', maj).where('minor', min).where('patch', '>=', pat))
        })
        break
      case '>':
        query.where((q: any) => {
          q.where('major', '>', maj)
           .orWhere((sq: any) => sq.where('major', maj).where('minor', '>', min))
           .orWhere((sq: any) => sq.where('major', maj).where('minor', min).where('patch', '>', pat))
        })
        break
      case '<=':
        query.where((q: any) => {
          q.where('major', '<', maj)
           .orWhere((sq: any) => sq.where('major', maj).where('minor', '<', min))
           .orWhere((sq: any) => sq.where('major', maj).where('minor', min).where('patch', '<=', pat))
        })
        break
      case '<':
        query.where((q: any) => {
          q.where('major', '<', maj)
           .orWhere((sq: any) => sq.where('major', maj).where('minor', '<', min))
           .orWhere((sq: any) => sq.where('major', maj).where('minor', min).where('patch', '<', pat))
        })
        break
      default:
        query.where('major', maj).where('minor', min).where('patch', pat)
    }
  }

  async getFilteredVersions(page: number, limit: number, filters: any) {
    const query = this.versionRepository.query().orderBy('createdAt', 'desc')

    if (filters.versionNumber) {
      this.parseSemverFilter(query, filters.versionNumber)
    }

    if (filters.codename) {
      query.whereRaw('LOWER(codename) LIKE ?', [`%${filters.codename.toLowerCase()}%`])
    }

    if (filters.isActive !== undefined && filters.isActive !== '') {
      query.where('isActive', filters.isActive === '1' || filters.isActive === true)
    }

    if (filters.dateFrom) {
      const sqlDate = DateTime.fromISO(filters.dateFrom).startOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '>=', sqlDate)
    }

    if (filters.dateTo) {
      const sqlDate = DateTime.fromISO(filters.dateTo).endOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '<=', sqlDate)
    }

    return await query.paginate(page, limit)
  }

  async validateAndCheckDuplicate(vString: string, major: number, minor: number, patch: number, excludeId?: number | string) {
    if (!semver.valid(vString)) {
      throw new Error(`Invalid semantic version number: ${vString}.`)
    }

    const q = this.versionRepository.query()
      .where('major', major)
      .where('minor', minor)
      .where('patch', patch)

    if (excludeId) {
      q.whereNot('id', excludeId)
    }

    const existing = await q.first()
    if (existing) {
      throw new Error(`Version ${vString} already exists.`)
    }
  }

  async createVersion(data: any) {
    const major = Number.parseInt(data.major)
    const minor = Number.parseInt(data.minor)
    const patch = Number.parseInt(data.patch)
    const vString = `${major}.${minor}.${patch}`

    await this.validateAndCheckDuplicate(vString, major, minor, patch)

    return await this.versionRepository.create({
      major,
      minor,
      patch,
      codename: data.codename,
      changelog: data.changelogs || data.changelog,
      isActive: data.isActive === 'on',
      releaseDate: data.releaseDate ? DateTime.fromISO(data.releaseDate) : null,
    })
  }

  async getVersion(id: string | number) {
    return await this.versionRepository.findById(id)
  }

  async updateVersion(id: string | number, data: any) {
    const version = await this.versionRepository.findById(id)
    const major = Number.parseInt(data.major)
    const minor = Number.parseInt(data.minor)
    const patch = Number.parseInt(data.patch)
    const vString = `${major}.${minor}.${patch}`

    await this.validateAndCheckDuplicate(vString, major, minor, patch, version.id)

    version.merge({
      major,
      minor,
      patch,
      codename: data.codename,
      changelog: data.changelogs || data.changelog,
      isActive: data.isActive === 'on' || data.isActive === true,
      releaseDate: data.releaseDate ? DateTime.fromISO(data.releaseDate) : null,
    })

    return await this.versionRepository.update(version)
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
      throw new Error('Cannot delete version because it has associated artifacts. Delete the artifacts first.')
    }

    await this.versionRepository.delete(version)
    return version
  }
}

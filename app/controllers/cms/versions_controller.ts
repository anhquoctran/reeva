import Version from '#models/version'
import Artifact from '#models/artifact'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import semver from 'semver'

export default class VersionsController {
  private parseSemverFilter(query: any, input: string) {
    const semverRegex = /^([<>]=?|==)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(\*)?$/
    const match = input.trim().match(semverRegex)

    if (!match) {
      // If it's just a string, try searching codename or skip
      return
    }

    const [_, operator = '==', major, minor = '0', patch = '0', wildcard] = match
    const maj = Number.parseInt(major)
    const min = Number.parseInt(minor)
    const pat = Number.parseInt(patch)

    if (wildcard) {
      query.where('major', maj)
      if (match[3]) query.where('minor', min)
      return
    }

    // Comparison logic
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
      default: // == or no operator
        query.where('major', maj).where('minor', min).where('patch', pat)
    }
  }

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    
    // Filters
    const vNum = request.input('versionNumber')
    const codename = request.input('codename')
    const isActive = request.input('isActive')
    const dateFrom = (request.input('dateFrom') as string) || null
    const dateTo = (request.input('dateTo') as string) || null

    const query = Version.query().orderBy('createdAt', 'desc')

    if (vNum) {
      this.parseSemverFilter(query, vNum)
    }

    if (codename) {
      query.whereRaw('LOWER(codename) LIKE ?', [`%${codename.toLowerCase()}%`])
    }

    if (isActive !== undefined && isActive !== '') {
      query.where('isActive', isActive === '1')
    }

    if (dateFrom) {
      const sqlDate = DateTime.fromISO(dateFrom).startOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '>=', sqlDate)
    }

    if (dateTo) {
      const sqlDate = DateTime.fromISO(dateTo).endOf('day').toSQLDate()
      if (sqlDate) query.where('releaseDate', '<=', sqlDate)
    }

    const versions = await query.paginate(page, limit)
    versions.baseUrl(request.url())
    versions.queryString(request.qs())

    return view.render('pages/cms/versions/index', { 
      versions, 
      filters: { versionNumber: vNum, codename, isActive, dateFrom, dateTo } 
    })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/versions/create')
  }

  async store({ request, response, session }: HttpContext) {
    const data = request.all()
    const major = Number.parseInt(data.major)
    const minor = Number.parseInt(data.minor)
    const patch = Number.parseInt(data.patch)
    const vString = `${major}.${minor}.${patch}`

    // 1. Semver validation
    if (!semver.valid(vString)) {
      session.flash('error', `Invalid semantic version number: ${vString}.`)
      session.flashAll()
      return response.redirect().back()
    }

    // 2. Duplicate check on M.M.P triplet
    const existing = await Version.query()
      .where('major', major)
      .where('minor', minor)
      .where('patch', patch)
      .first()

    if (existing) {
      session.flash('error', `Version ${vString} already exists.`)
      session.flashAll()
      return response.redirect().back()
    }
    
    await Version.create({
      major,
      minor,
      patch,
      codename: data.codename,
      changelog: data.changelogs || data.changelog,
      isActive: data.isActive === 'on',
      releaseDate: data.releaseDate ? DateTime.fromISO(data.releaseDate) : null,
    })

    session.flash('success', 'Version created successfully.')
    return response.redirect().toRoute('cms.versions.index')
  }

  async edit({ params, view }: HttpContext) {
    const version = await Version.findOrFail(params.id)
    return view.render('pages/cms/versions/edit', { version })
  }

  async update({ params, request, response, session }: HttpContext) {
    const version = await Version.findOrFail(params.id)
    const data = request.all()
    const major = Number.parseInt(data.major)
    const minor = Number.parseInt(data.minor)
    const patch = Number.parseInt(data.patch)
    const vString = `${major}.${minor}.${patch}`

    // 1. Semver validation
    if (!semver.valid(vString)) {
      session.flash('error', `Invalid semantic version: ${vString}.`)
      session.flashAll()
      return response.redirect().back()
    }

    // 2. Duplicate check (exclude current)
    const existing = await Version.query()
      .where('major', major)
      .where('minor', minor)
      .where('patch', patch)
      .whereNot('id', version.id)
      .first()
    
    if (existing) {
      session.flash('error', `Version ${vString} is already registered.`)
      session.flashAll()
      return response.redirect().back()
    }

    version.merge({
      major,
      minor,
      patch,
      codename: data.codename,
      changelog: data.changelogs || data.changelog,
      isActive: data.isActive === 'on' || data.isActive === true,
      releaseDate: data.releaseDate ? DateTime.fromISO(data.releaseDate) : null,
    })

    await version.save()

    session.flash('success', 'Version updated successfully.')
    return response.redirect().toRoute('cms.versions.index')
  }

  async toggle({ params, response, session }: HttpContext) {
    const version = await Version.findOrFail(params.id)
    version.isActive = !version.isActive
    await version.save()

    session.flash('success', `Version ${version.isActive ? 'activated' : 'deactivated'} successfully.`)
    return response.redirect().back()
  }

  async destroy({ params, response, session }: HttpContext) {
    const version = await Version.findOrFail(params.id)

    // Check if version is in use
    const hasArtifacts = await Artifact.query().where('versionId', version.id).first()
    if (hasArtifacts) {
      session.flash('error', 'Cannot delete version because it has associated artifacts. Delete the artifacts first.')
      return response.redirect().back()
    }

    await version.delete()

    session.flash('success', 'Version deleted successfully.')
    return response.redirect().toRoute('cms.versions.index')
  }
}
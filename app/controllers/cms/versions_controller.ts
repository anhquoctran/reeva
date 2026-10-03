import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import VersionService from '#services/version_service'
import { parsePage } from '#services/pagination'
import SoftwareService from '#services/software_service'

@inject()
export default class VersionsController {
  constructor(
    protected versionService: VersionService,
    protected softwareService: SoftwareService
  ) {}

  async index({ request, response, view }: HttpContext) {
    const page = parsePage(request.input('page'))
    if (!page) return response.status(400).send('Invalid page.')
    const limit = 10

    // Filters
    const versionNumber = request.input('versionNumber')
    const codename = request.input('codename')
    const isActive = request.input('isActive')
    const dateFrom = (request.input('dateFrom') as string) || null
    const dateTo = (request.input('dateTo') as string) || null

    const filters = { versionNumber, codename, isActive, dateFrom, dateTo }
    const softwareProducts = await this.softwareService.getAll()
    const requestedSoftwareId = request.input('softwareId')
    const defaultSoftware = await this.softwareService.getDefault()
    const selectedSoftwareId = requestedSoftwareId || defaultSoftware.id
    if (!softwareProducts.some((software) => software.id === selectedSoftwareId)) {
      return response.status(400).send('Invalid software selection.')
    }
    Object.assign(filters, { softwareId: selectedSoftwareId })
    let versions
    try {
      versions = await this.versionService.getFilteredVersions(page, limit, filters)
    } catch (error) {
      return response
        .status(400)
        .send(error instanceof Error ? error.message : 'Invalid version filters.')
    }

    versions.baseUrl(request.url())
    versions.queryString(request.qs())

    return view.render('pages/cms/versions/index', {
      versions,
      filters,
      softwareProducts,
      selectedSoftwareId,
    })
  }

  async create({ request, view, response }: HttpContext) {
    const allSoftwareProducts = await this.softwareService.getAll()
    const softwareProducts = allSoftwareProducts.filter((software) => software.isActive)
    const defaultSoftware = await this.softwareService.getDefault()
    const requestedSoftwareId = request.input('softwareId') || defaultSoftware.id
    if (!softwareProducts.some((software) => software.id === requestedSoftwareId)) {
      return response.status(400).send('Invalid or inactive software selection.')
    }
    return view.render('pages/cms/versions/create', {
      softwareProducts,
      selectedSoftwareId: requestedSoftwareId,
    })
  }

  async store({ request, response, session }: HttpContext) {
    const data = request.all()

    try {
      await this.versionService.createVersion(data)
      session.flash('success', 'Version created successfully.')
      return response
        .redirect()
        .toPath(`/cms/versions?softwareId=${encodeURIComponent(String(data.softwareId || ''))}`)
    } catch (error: any) {
      session.flash('error', error.message)
      session.flashAll()
      return response.redirect().back()
    }
  }

  async edit({ params, view }: HttpContext) {
    const version = await this.versionService.getVersion(params.id)
    return view.render('pages/cms/versions/edit', { version })
  }

  async update({ params, request, response, session }: HttpContext) {
    const data = request.all()

    try {
      await this.versionService.updateVersion(params.id, data)
      session.flash('success', 'Version updated successfully.')
      return response
        .redirect()
        .toPath(`/cms/versions?softwareId=${encodeURIComponent(String(data.softwareId || ''))}`)
    } catch (error: any) {
      session.flash('error', error.message)
      session.flashAll()
      return response.redirect().back()
    }
  }

  async toggle({ params, response, session }: HttpContext) {
    const version = await this.versionService.toggleVersion(params.id)
    session.flash(
      'success',
      `Version ${version.isActive ? 'activated' : 'deactivated'} successfully.`
    )
    return response.redirect().back()
  }

  async destroy({ params, response, session }: HttpContext) {
    try {
      await this.versionService.deleteVersion(params.id)
      session.flash('success', 'Version deleted successfully.')
      return response.redirect().toRoute('cms.versions.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }
}

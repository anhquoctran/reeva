import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import VersionService from '#services/version_service'

@inject()
export default class VersionsController {
  constructor(protected versionService: VersionService) {}

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    
    // Filters
    const versionNumber = request.input('versionNumber')
    const codename = request.input('codename')
    const isActive = request.input('isActive')
    const dateFrom = (request.input('dateFrom') as string) || null
    const dateTo = (request.input('dateTo') as string) || null

    const filters = { versionNumber, codename, isActive, dateFrom, dateTo }
    const versions = await this.versionService.getFilteredVersions(page, limit, filters)
    
    versions.baseUrl(request.url())
    versions.queryString(request.qs())

    return view.render('pages/cms/versions/index', { 
      versions, 
      filters 
    })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/versions/create')
  }

  async store({ request, response, session }: HttpContext) {
    const data = request.all()

    try {
      await this.versionService.createVersion(data)
      session.flash('success', 'Version created successfully.')
      return response.redirect().toRoute('cms.versions.index')
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
      return response.redirect().toRoute('cms.versions.index')
    } catch (error: any) {
      session.flash('error', error.message)
      session.flashAll()
      return response.redirect().back()
    }
  }

  async toggle({ params, response, session }: HttpContext) {
    const version = await this.versionService.toggleVersion(params.id)
    session.flash('success', `Version ${version.isActive ? 'activated' : 'deactivated'} successfully.`)
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
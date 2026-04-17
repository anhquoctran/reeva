import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import LicenseService from '#services/license_service'

@inject()
export default class LicensesController {
  constructor(protected licenseService: LicenseService) {}

  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const limit = 10
    
    // Filters
    const licenseKey = request.input('licenseKey')
    const customer = request.input('customer')
    const productName = request.input('productName')
    const status = request.input('status')

    const filters = { licenseKey, customer, productName, status }
    const licenses = await this.licenseService.getFilteredLicenses(page, limit, filters)
    
    licenses.baseUrl(request.url())
    licenses.queryString(request.qs())

    return view.render('pages/cms/licenses/index', { 
      licenses, 
      filters 
    })
  }

  async create({ view }: HttpContext) {
    return view.render('pages/cms/licenses/create')
  }

  async store({ request, response, session }: HttpContext) {
    const data = request.all()

    try {
      await this.licenseService.createLicense(data)
      session.flash('success', 'License created successfully.')
      return response.redirect().toRoute('cms.licenses.index' as any)
    } catch (error: any) {
      session.flash('error', error.message)
      session.flashAll()
      return response.redirect().back()
    }
  }

  async edit({ params, view }: HttpContext) {
    const license = await this.licenseService.getLicense(params.id)
    const activations = await this.licenseService.getActivations(params.id)
    return view.render('pages/cms/licenses/edit', { license, activations })
  }

  async update({ params, request, response, session }: HttpContext) {
    const data = request.all()

    try {
      await this.licenseService.updateLicense(params.id, data)
      session.flash('success', 'License updated successfully.')
      return response.redirect().toRoute('cms.licenses.index' as any)
    } catch (error: any) {
      session.flash('error', error.message)
      session.flashAll()
      return response.redirect().back()
    }
  }

  async activate({ params, request, response, session }: HttpContext) {
    const machineId = request.input('machineId')
    try {
      const token = await this.licenseService.issueActivationToken(params.id, machineId)
      session.flash('success', 'Device activated successfully.')
      session.flash('activationToken', token)
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async destroyActivation({ params, response, session }: HttpContext) {
    try {
      await this.licenseService.removeActivation(params.id, params.activationId)
      session.flash('success', 'Activation removed successfully.')
      return response.redirect().back()
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async toggle({ params, response, session }: HttpContext) {
    const license = await this.licenseService.toggleLicense(params.id)
    session.flash('success', `License status updated to ${license.status} successfully.`)
    return response.redirect().back()
  }

  async destroy({ params, response, session }: HttpContext) {
    try {
      await this.licenseService.deleteLicense(params.id)
      session.flash('success', 'License deleted successfully.')
      return response.redirect().toRoute('cms.licenses.index' as any)
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }
}

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SoftwareService from '#services/software_service'

@inject()
export default class SoftwareController {
  constructor(protected softwareService: SoftwareService) {}

  async index({ view }: HttpContext) {
    return view.render('pages/cms/software/index', {
      softwareProducts: await this.softwareService.getAll(),
    })
  }

  async store({ request, response, session }: HttpContext) {
    try {
      await this.softwareService.create(request.all())
      session.flash('success', 'Software added successfully.')
    } catch (error) {
      session.flash('error', error instanceof Error ? error.message : 'Could not add software.')
      session.flashAll()
    }
    return response.redirect().back()
  }

  async toggle({ params, response, session }: HttpContext) {
    try {
      const software = await this.softwareService.toggleActive(params.id)
      session.flash(
        'success',
        `${software.name} is now ${software.isActive ? 'active' : 'inactive'}.`
      )
    } catch (error) {
      session.flash('error', error instanceof Error ? error.message : 'Could not update software.')
    }
    return response.redirect().back()
  }

  async update({ params, request, response, session }: HttpContext) {
    try {
      const software = await this.softwareService.updateName(params.id, request.input('name'))
      session.flash(
        'success',
        `${software.name} was updated. Use Sync All Names on Artifacts to refresh existing filenames.`
      )
    } catch (error) {
      session.flash('error', error instanceof Error ? error.message : 'Could not update software.')
    }
    return response.redirect().back()
  }

  async setDefault({ params, response, session }: HttpContext) {
    try {
      const software = await this.softwareService.setDefault(params.id)
      session.flash('success', `${software.name} is now the default for legacy OTA clients.`)
    } catch (error) {
      session.flash('error', error instanceof Error ? error.message : 'Could not select default.')
    }
    return response.redirect().back()
  }
}

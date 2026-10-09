import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SoftwareService from '#services/software_service'
import { parsePage } from '#services/pagination'
import ManagedSignerService from '#services/managed_signer_service'

@inject()
export default class SoftwareController {
  constructor(protected softwareService: SoftwareService) {}

  async index({ view, request }: HttpContext) {
    let page = parsePage(request.input('page'))
    const keyword = request.input('keyword')
    if (!page) page = 1
    return view.render('pages/cms/software/index', {
      softwareProducts: await this.softwareService.getAllWithSigningKeys(keyword, page),
      managedSignerConfigured: new ManagedSignerService().configured,
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

  async addSigningKey({ params, request, response, session }: HttpContext) {
    try {
      const key = await this.softwareService.addSigningKey(params.id, request.input('publicKey'))
      session.flash(
        'success',
        `Ed25519 public key ${key.keyId} added. Keep its private key outside Reeva.`
      )
    } catch (error) {
      session.flash('error', error instanceof Error ? error.message : 'Could not add signing key.')
    }
    return response.redirect().back()
  }

  async revokeSigningKey({ params, response, session }: HttpContext) {
    try {
      await this.softwareService.revokeSigningKey(params.id, params.keyId)
      session.flash('success', 'Signing key revoked. Releases signed by it are no longer eligible.')
    } catch (error) {
      session.flash(
        'error',
        error instanceof Error ? error.message : 'Could not revoke signing key.'
      )
    }
    return response.redirect().back()
  }

  async importManagedSigningKey({ params, response, session }: HttpContext) {
    try {
      await this.softwareService.importManagedSigningKey(params.id)
      session.flash(
        'success',
        'Managed signer public key registered. Pin it in your client before requiring signatures.'
      )
    } catch (error) {
      session.flash(
        'error',
        error instanceof Error ? error.message : 'Could not import signer key.'
      )
    }
    return response.redirect().back()
  }

  async setSignedUpdates({ params, request, response, session }: HttpContext) {
    try {
      const software = await this.softwareService.setRequireSignedUpdates(
        params.id,
        request.input('requireSignedUpdates')
      )
      session.flash(
        'success',
        `Signed updates are now ${software.requireSignedUpdates ? 'required' : 'optional'} for ${software.name}.`
      )
    } catch (error) {
      session.flash(
        'error',
        error instanceof Error ? error.message : 'Could not update signature policy.'
      )
    }
    return response.redirect().back()
  }
}

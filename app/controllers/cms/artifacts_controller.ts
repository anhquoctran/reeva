import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ArtifactService from '#services/artifact_service'

@inject()
export default class ArtifactsController {
  constructor(protected artifactService: ArtifactService) {}

  /** Returns artifact details and paginated download history as JSON. */
  async details({ params, request, response }: HttpContext) {
    const page = request.input('page', 1)
    const { artifact, history } = await this.artifactService.getDetails(params.id, page)
    return response.json({ artifact, history: history.toJSON() })
  }

  /** Rebuild ALL artifact filenames and recalculate checksums. */
  async rebuildAllNames({ response, session }: HttpContext) {
    const updatedCount = await this.artifactService.rebuildAllNames()
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

    const { artifacts, versions, platforms, architectures } =
      await this.artifactService.getIndexData(page, limit, filters)

    artifacts.baseUrl(request.url())
    artifacts.queryString(request.qs())

    return view.render('pages/cms/artifacts/index', {
      artifacts,
      filters,
      versions,
      platforms,
      architectures,
    })
  }

  async create({ view, response, session }: HttpContext) {
    try {
      const data = await this.artifactService.getCreateData()
      return view.render('pages/cms/artifacts/create', data)
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().toRoute('cms.artifacts.index')
    }
  }

  async store({ request, response, session }: HttpContext) {
    const file = request.file('file')

    if (!file) {
      session.flash('errors.file', 'Artifact file is required.')
      return response.redirect().back()
    }

    if (!file.isValid) {
      session.flash('errors.file', file.errors.map((e) => e.message).join(', '))
      return response.redirect().back()
    }

    const data = request.all()

    try {
      await this.artifactService.uploadArtifact(file, data)
      session.flash('success', 'Artifact uploaded successfully.')
      return response.redirect().toRoute('cms.artifacts.index')
    } catch (error: any) {
      // Map field-level errors vs general errors
      if (error.message.includes('extension')) {
        session.flash('errors.file', error.message)
      } else if (error.message.includes('architecture')) {
        session.flash('errors.architectureId', error.message)
      } else {
        session.flash('error', error.message)
      }
      return response.redirect().back()
    }
  }

  async edit({ params, view }: HttpContext) {
    const data = await this.artifactService.getEditData(params.id)
    return view.render('pages/cms/artifacts/edit', data)
  }

  async update({ params, request, response, session }: HttpContext) {
    const data = request.all()

    try {
      const { newFileName } = await this.artifactService.updateArtifact(params.id, data)
      session.flash('success', `Artifact updated and filename synchronized: ${newFileName}`)
      return response.redirect().toRoute('cms.artifacts.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async destroy({ params, response, session }: HttpContext) {
    try {
      await this.artifactService.deleteArtifact(params.id)
      session.flash('success', 'Artifact deleted successfully.')
      return response.redirect().toRoute('cms.artifacts.index')
    } catch (error: any) {
      session.flash('error', error.message)
      return response.redirect().back()
    }
  }

  async publish({ params, response, session }: HttpContext) {
    try {
      const artifact = await this.artifactService.publishArtifact(params.id)
      session.flash('success', `Artifact ${artifact.fileName} has been published and is now visible to the API.`)
      return response.redirect().back()
    } catch (error: any) {
      session.flash('info', error.message)
      return response.redirect().back()
    }
  }
}
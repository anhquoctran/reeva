import Artifact from '#models/artifact'

export default class ArtifactRepository {
  query() {
    return Artifact.query()
  }

  /**
   * Canonical query for OTA-visible artifacts. Keep every public read path on
   * this predicate so ID downloads and local URLs cannot bypass publication.
   */
  publicQuery(softwareId?: string) {
    return Artifact.query()
      .whereNull('artifacts.deleted_at')
      .whereExists((query) => {
        query
          .from('versions as eligible_versions')
          .join(
            'software as eligible_software',
            'eligible_software.id',
            'eligible_versions.software_id'
          )
          .whereColumn('eligible_versions.id', 'artifacts.version_id')
          .whereNull('eligible_versions.deleted_at')
          .where('eligible_versions.is_active', true)
          .where('eligible_software.is_active', true)
        if (softwareId) query.where('eligible_software.id', softwareId)
      })
      .whereExists((query) => {
        query
          .from('platforms as eligible_platforms')
          .whereColumn('eligible_platforms.id', 'artifacts.platform_id')
          .whereNull('eligible_platforms.deleted_at')
      })
      .whereExists((query) => {
        query
          .from('architectures as eligible_architectures')
          .whereColumn('eligible_architectures.id', 'artifacts.architecture_id')
          .whereNull('eligible_architectures.deleted_at')
      })
      .whereExists((query) => {
        query
          .from('storage_providers as sp')
          .whereColumn('sp.id', 'artifacts.storage_provider_id')
          .whereNull('sp.deleted_at')
          .where('sp.is_active', true)
      })
      .where('artifacts.is_published', true)
      .where('artifacts.is_archived', false)
      .select('artifacts.*')
  }

  async findPublicById(id: string, softwareId?: string) {
    return this.publicQuery(softwareId)
      .where('artifacts.id', id)
      .preload('version')
      .preload('platform')
      .preload('architecture')
      .preload('storageProvider')
      .first()
  }

  async findPublicByStorageKey(key: string) {
    return this.publicQuery().where('artifacts.storage_key', key).preload('storageProvider').first()
  }

  async findByVersionId(versionId: string | number) {
    return await Artifact.query().where('versionId', versionId).first()
  }
}

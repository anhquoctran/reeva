import Artifact from '#models/artifact'

export default class ArtifactRepository {
  query() {
    return Artifact.query()
  }

  async findByVersionId(versionId: string | number) {
    return await Artifact.query().where('versionId', versionId).first()
  }
}

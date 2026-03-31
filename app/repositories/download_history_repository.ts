import DownloadHistory from '#models/download_history'

export default class DownloadHistoryRepository {
  query() {
    return DownloadHistory.query()
  }

  async findByArtifactId(artifactId: string | number) {
    return await DownloadHistory.query().where('artifactId', artifactId)
  }
}

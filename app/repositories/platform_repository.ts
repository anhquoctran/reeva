import Platform from '#models/platform'

export default class PlatformRepository {
  query() {
    return Platform.query()
  }

  async findById(id: string | number) {
    return await Platform.findOrFail(id)
  }
}

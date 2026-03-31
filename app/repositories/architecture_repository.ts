import Architecture from '#models/architecture'

export default class ArchitectureRepository {
  query() {
    return Architecture.query()
  }

  async findById(id: string | number) {
    return await Architecture.findOrFail(id)
  }
}

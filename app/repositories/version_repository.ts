import Version from '#models/version'

export default class VersionRepository {
  query() {
    return Version.query()
  }

  async findById(id: string | number) {
    return await Version.query().preload('software').where('id', id).firstOrFail()
  }

  async create(data: Partial<Version>) {
    return await Version.create(data)
  }

  async update(version: Version) {
    return await version.save()
  }

  async delete(version: Version) {
    return await version.delete()
  }
}

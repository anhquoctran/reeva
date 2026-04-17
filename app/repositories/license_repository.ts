import License from '#models/license'

export default class LicenseRepository {
  query() {
    return License.query()
  }

  async findById(id: string | number) {
    return await License.findOrFail(id)
  }

  async create(data: Partial<License>) {
    return await License.create(data)
  }

  async update(license: License) {
    return await license.save()
  }

  async delete(license: License) {
    return await license.delete()
  }
}

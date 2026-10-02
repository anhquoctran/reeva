import Software from '#models/software'

export default class SoftwareRepository {
  query() {
    return Software.query()
  }

  async findById(id: string) {
    return Software.findOrFail(id)
  }

  async findBySlug(slug: string) {
    return Software.query().where('slug', slug).first()
  }

  async findDefault() {
    return Software.query().where('isDefault', true).first()
  }

  async findActiveBySlug(slug: string) {
    return Software.query().where('slug', slug).where('isActive', true).first()
  }

  async findActiveDefault() {
    return Software.query().where('isDefault', true).where('isActive', true).first()
  }
}

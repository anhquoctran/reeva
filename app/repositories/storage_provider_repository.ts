import StorageProvider from '#models/storage_provider'

export default class StorageProviderRepository {
  query() {
    return StorageProvider.query()
  }

  async findById(id: string | number) {
    return await StorageProvider.findOrFail(id)
  }
}

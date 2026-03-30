import type { ApplicationService } from '@adonisjs/core/types'
import StorageManager from '../app/services/storage/storage_manager.js'

export default class StorageProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * The container is providing the application instance.
   */
  public register() {}

  /**
   * The application has been booted.
   */
  public async boot() {
    // We wait for the DB provider to boot first (Lucid is usually at the start)
    // but Adonis 6 manages the order.
  }

  /**
   * The application is ready.
   */
  public async ready() {
    // Initial boot of the storage driver from DB
    await StorageManager.boot()
  }

  /**
   * The application is shutting down.
   */
  public async shutdown() {}
}

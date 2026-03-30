import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'storage_providers'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.bigInteger('quota_bytes').nullable().defaultTo(10 * 1024 * 1024 * 1024) // Default 10GB
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('quota_bytes')
    })
  }
}
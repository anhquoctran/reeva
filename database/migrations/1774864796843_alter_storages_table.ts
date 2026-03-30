import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'storage_providers'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_active').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_active')
    })
  }
}
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('theme', 10).defaultTo('system').after('is_root')
      table.integer('accent_color').defaultTo(0).after('theme')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('theme')
      table.dropColumn('accent_color')
    })
  }
}

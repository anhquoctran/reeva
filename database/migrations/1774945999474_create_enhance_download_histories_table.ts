import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'download_histories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.double('lat').nullable()
      table.double('lng').nullable()
      table.string('country_code').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('lat')
      table.dropColumn('lng')
      table.dropColumn('country_code')
    })
  }
}
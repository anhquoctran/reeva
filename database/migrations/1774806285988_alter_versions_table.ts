import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'versions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('version_number')
      
      // Ensure the M.M.P triplet is unique now
      table.unique(['major', 'minor', 'patch'], 'unique_m_m_p')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('version_number', 50).nullable()
      table.dropUnique(['major', 'minor', 'patch'], 'unique_m_m_p')
    })
  }
}
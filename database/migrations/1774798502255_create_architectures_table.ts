import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'architectures'

  async up() {
    const isPg = db.connection().dialect.name === 'postgres'
    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }
      table.string('name', 50).notNullable().unique()
      table.string('display_name', 100).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
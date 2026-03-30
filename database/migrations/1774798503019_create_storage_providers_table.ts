import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'storage_providers'

  async up() {
    const isPg = db.connection().dialect.name === 'postgres'
    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }

      table.string('name', 100).notNullable()
      table.string('type', 50).notNullable()

      table.jsonb('config').notNullable()

      table.boolean('is_default').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })

    // Only one default provider (Partial unique index)
    if (isPg) {
      this.schema.raw(`
        CREATE UNIQUE INDEX uq_storage_default
        ON ${this.tableName} (is_default)
        WHERE is_default = TRUE;
      `)
    }
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
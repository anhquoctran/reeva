import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'download_histories'

  async up() {
    const isPg = db.connection().dialect.name === 'postgres'
    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }
      
      table.uuid('artifact_id').notNullable().references('id').inTable('artifacts').onDelete('CASCADE')
      table.string('ip_address', 50).nullable()
      table.text('user_agent').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'artifacts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('channel').notNullable().defaultTo('dev')
      table.boolean('is_published').notNullable().defaultTo(false)
      table.timestamp('published_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumns('channel', 'is_published', 'published_at')
    })
  }
}
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'licenses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary()
      table.string('license_key', 255).notNullable().unique()
      table.string('product_name', 255).notNullable()
      table.string('customer_name', 255).nullable()
      table.string('customer_email', 255).nullable()
      table.string('status', 50).notNullable().defaultTo('active')
      table.timestamp('expires_at').nullable()
      table.timestamp('revoked_at').nullable()
      
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
      table.timestamp('deleted_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
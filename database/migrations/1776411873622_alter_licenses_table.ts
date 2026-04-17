import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'licenses'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('max_activations').notNullable().defaultTo(1).after('status')
      table.integer('activation_count', 11).notNullable().defaultTo(0).after('max_activations')
    })

    this.schema.createTable('license_activations', (table) => {
      table.uuid('id').primary()
      table.uuid('license_id').references('id').inTable('licenses').onDelete('CASCADE')
      table.string('machine_id', 255).notNullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable('license_activations')
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumns('max_activations', 'activation_count')
    })
  }
}
import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'versions'

  async up() {
    const isPg = db.connection().dialect.name === 'postgres'
    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }

      table.string('version_number', 50).notNullable().unique()
      table.string('codename', 100).nullable()

      table.integer('major').notNullable()
      table.integer('minor').notNullable()
      table.integer('patch').notNullable()

      table.timestamp('release_date').nullable()
      table.text('changelog').nullable()

      table.boolean('is_active').notNullable().defaultTo(true)

      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })

    // Index for semver sorting
    this.schema.alterTable(this.tableName, (table) => {
      // In knex/lucid we can't always specify DESC easily in a multi-column index via standard methods
      // So we use raw SQL if we want the exact index
      table.index(['major', 'minor', 'patch'], 'idx_versions_semver')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
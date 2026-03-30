import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'artifacts'

  async up() {
    const isPg = db.connection().dialect.name === 'postgres'
    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }

      table.uuid('version_id').notNullable().references('id').inTable('versions').onDelete('CASCADE')
      table.uuid('platform_id').notNullable().references('id').inTable('platforms')
      table.uuid('architecture_id').notNullable().references('id').inTable('architectures')
      table.uuid('storage_provider_id').notNullable().references('id').inTable('storage_providers')

      table.string('file_name', 255).notNullable()
      table.string('mime_type', 100).nullable()
      table.bigInteger('size_bytes').nullable()

      table.string('checksum', 128).nullable()
      table.string('storage_key', 500).notNullable()

      table.integer('download_count').notNullable().defaultTo(0)
      table.boolean('is_archived').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable().defaultTo(this.now())

      // Composite unique constraint
      table.unique(['version_id', 'platform_id', 'architecture_id'], 'uq_artifacts_unique')
    })

    // Additional indexes
    this.schema.alterTable(this.tableName, (table) => {
      table.index('version_id', 'idx_artifacts_version')
      table.index(['platform_id', 'architecture_id'], 'idx_artifacts_platform_arch')
      table.index('storage_provider_id', 'idx_artifacts_provider')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
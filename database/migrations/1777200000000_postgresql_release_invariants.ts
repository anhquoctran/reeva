import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // The configured Adonis database store requires this table.
    this.schema.createTable('sessions', (table) => {
      table.string('id').primary()
      table.text('data').notNullable()
      table.string('user_id').nullable().index()
      table.timestamp('expires_at').notNullable().index()
    })
    this.schema.raw('DROP INDEX uq_storage_default')
    this.schema.raw(
      'CREATE UNIQUE INDEX uq_storage_default ON storage_providers (is_default) WHERE is_default = TRUE AND deleted_at IS NULL'
    )
    this.schema.raw(
      'CREATE UNIQUE INDEX uq_software_default ON software (is_default) WHERE is_default = TRUE'
    )
    this.schema.raw(
      'ALTER TABLE software ADD CONSTRAINT chk_software_default_active CHECK (NOT is_default OR is_active)'
    )
    this.schema.alterTable('download_histories', (table) => {
      table.index(['deleted_at', 'created_at'], 'idx_download_histories_live_created')
    })
  }

  async down() {
    this.schema.dropTable('sessions')
    this.schema.raw('DROP INDEX uq_storage_default')
    this.schema.raw(
      'CREATE UNIQUE INDEX uq_storage_default ON storage_providers (is_default) WHERE is_default = TRUE'
    )
    this.schema.raw('DROP INDEX uq_software_default')
    this.schema.raw('ALTER TABLE software DROP CONSTRAINT chk_software_default_active')
    this.schema.alterTable('download_histories', (table) => {
      table.dropIndex(['deleted_at', 'created_at'], 'idx_download_histories_live_created')
    })
  }
}

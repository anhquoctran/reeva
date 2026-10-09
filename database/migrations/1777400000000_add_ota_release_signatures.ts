import { BaseSchema } from '@adonisjs/lucid/schema'

/** Adds externally generated Ed25519 signatures to OTA release metadata. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('software', (table) => {
      table.boolean('require_signed_updates').notNullable().defaultTo(false)
    })

    this.schema.createTable('software_signing_keys', (table) => {
      table.uuid('id').primary()
      table
        .uuid('software_id')
        .notNullable()
        .references('id')
        .inTable('software')
        .onDelete('CASCADE')
      table.string('key_id', 64).notNullable()
      table.text('public_key').notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
      table.unique(['key_id'], 'uq_software_signing_keys_key_id')
      table.index(['software_id', 'is_active'], 'idx_software_signing_keys_active')
    })

    this.schema.alterTable('artifacts', (table) => {
      table.text('signature').nullable()
      table.string('signature_key_id', 64).nullable()
      table.jsonb('signature_manifest').nullable()
      table.index(['signature_key_id'], 'idx_artifacts_signature_key')
    })
  }

  async down() {
    this.schema.alterTable('artifacts', (table) => {
      table.dropIndex(['signature_key_id'], 'idx_artifacts_signature_key')
      table.dropColumn('signature')
      table.dropColumn('signature_key_id')
      table.dropColumn('signature_manifest')
    })
    this.schema.dropTable('software_signing_keys')
    this.schema.alterTable('software', (table) => {
      table.dropColumn('require_signed_updates')
    })
  }
}

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.integer('auth_version').notNullable().defaultTo(0)
    })

    this.schema.createTable('auth_rate_limits', (table) => {
      table.string('key', 64).primary()
      table.integer('attempts').notNullable()
      table.timestamp('window_ends_at').notNullable().index()
    })

    this.schema.createTable('storage_upload_reservations', (table) => {
      table.uuid('id').primary()
      table.uuid('storage_provider_id').notNullable().references('id').inTable('storage_providers')
      table.bigInteger('size_bytes').notNullable()
      table.timestamp('expires_at').notNullable().index()
      table.timestamp('created_at').notNullable()
      table.index(['storage_provider_id', 'expires_at'], 'idx_upload_reservations_provider_expiry')
    })

    this.schema.alterTable('artifacts', (table) => {
      table.index(
        [
          'platform_id',
          'architecture_id',
          'channel',
          'is_published',
          'is_archived',
          'deleted_at',
          'version_id',
          'id',
        ],
        'idx_artifacts_public_release'
      )
    })

    this.defer(async (client) => {
      await client.from('remember_me_tokens').delete()
    })
  }

  async down() {
    this.schema.alterTable('artifacts', (table) => {
      table.dropIndex(
        [
          'platform_id',
          'architecture_id',
          'channel',
          'is_published',
          'is_archived',
          'deleted_at',
          'version_id',
          'id',
        ],
        'idx_artifacts_public_release'
      )
    })
    this.schema.dropTable('storage_upload_reservations')
    this.schema.dropTable('auth_rate_limits')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('auth_version')
    })
  }
}

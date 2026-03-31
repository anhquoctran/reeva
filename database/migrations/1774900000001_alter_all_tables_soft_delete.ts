import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tables = [
    'architectures',
    'artifacts',
    'download_histories',
    'platforms',
    'settings',
    'storage_providers',
    'versions',
    'remember_me_tokens',
    'password_reset_tokens'
  ]

  async up() {
    for (const tableName of this.tables) {
      if (await this.schema.hasTable(tableName)) {
        this.schema.alterTable(tableName, (table) => {
          table.timestamp('deleted_at').nullable().defaultTo(null)
        })
      }
    }
  }

  async down() {
    for (const tableName of this.tables) {
      if (await this.schema.hasTable(tableName)) {
        this.schema.alterTable(tableName, (table) => {
          table.dropColumn('deleted_at')
        })
      }
    }
  }
}

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'artifacts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['version_id', 'platform_id', 'architecture_id'], 'uq_artifacts_unique')
      table.unique(['version_id', 'platform_id', 'architecture_id', 'channel'], 'uq_artifacts_system_channel')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['version_id', 'platform_id', 'architecture_id', 'channel'], 'uq_artifacts_system_channel')
      table.unique(['version_id', 'platform_id', 'architecture_id'], 'uq_artifacts_unique')
    })
  }
}
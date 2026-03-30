import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_root').defaultTo(false).notNullable()
    })

    // Mark the first user (earliest created) as root
    this.defer(async (db) => {
      const firstUser = await db.from('users').orderBy('created_at', 'asc').first()
      if (firstUser) {
        await db.from('users').where('id', firstUser.id).update({ is_root: true })
      }
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_root')
    })
  }
}
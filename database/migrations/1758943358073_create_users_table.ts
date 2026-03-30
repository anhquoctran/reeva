import { BaseSchema } from '@adonisjs/lucid/schema'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    // Ensure pgcrypto extension is available if on Postgres
    const isPg = db.connection().dialect.name === 'postgres'
    if (isPg) {
      await this.db.rawQuery('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
    }

    this.schema.createTable(this.tableName, (table) => {
      const id = table.uuid('id').primary()
      if (isPg) {
        id.defaultTo(this.db.rawQuery('gen_random_uuid()'))
      }

      table.string('email', 255).notNullable().unique()
      table.string('password_hash', 255).notNullable()

      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
    })

    // Add trigger for updated_at if on Postgres
    if (isPg) {
      await this.db.rawQuery(`
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `)
      await this.db.rawQuery(`
        CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
      `)
    }
  }

  async down() {
    this.schema.dropTable(this.tableName)
    // Optionally we could drop the trigger/function but they might be used elsewhere
  }
}

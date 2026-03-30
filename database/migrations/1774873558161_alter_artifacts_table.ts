import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'artifacts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('checksum_md5', 32).after('checksum').nullable()
      table.string('checksum_sha1', 40).after('checksum_md5').nullable()
      table.string('checksum_sha256', 64).after('checksum_sha1').nullable()
      table.string('checksum_sha512', 128).after('checksum_sha256').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('checksum_md5')
      table.dropColumn('checksum_sha1')
      table.dropColumn('checksum_sha256')
      table.dropColumn('checksum_sha512')
    })
  }
}
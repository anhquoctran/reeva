import { BaseSchema } from '@adonisjs/lucid/schema'
import { randomUUID } from 'node:crypto'

/** Adds a product boundary while preserving every existing version under the default product. */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('software', (table) => {
      table.uuid('id').primary()
      table.string('name', 120).notNullable()
      table.string('slug', 80).notNullable().unique('uq_software_slug')
      table.boolean('is_active').notNullable().defaultTo(true)
      table.boolean('is_default').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
      table.index(['is_active', 'is_default'], 'idx_software_active_default')
    })

    const appNameSetting = await this.db.from('settings').where('key', 'appName').first()
    const defaultSoftwareId = randomUUID()
    const appName =
      typeof appNameSetting?.value === 'string' && appNameSetting.value.trim()
        ? appNameSetting.value.trim().slice(0, 120)
        : 'Reeva'

    this.schema.alterTable('versions', (table) => {
      table.uuid('software_id').nullable().references('id').inTable('software').onDelete('RESTRICT')
    })

    this.defer(async (client) => {
      await client.table('software').insert({
        id: defaultSoftwareId,
        name: appName,
        slug: 'reeva',
        is_active: true,
        is_default: true,
      })
      await client.from('versions').update({ software_id: defaultSoftwareId })
    })

    this.schema.alterTable('versions', (table) => {
      table.uuid('software_id').notNullable().alter()
    })

    this.schema.alterTable('versions', (table) => {
      table.dropUnique(['major', 'minor', 'patch'], 'unique_m_m_p')
      table.unique(['software_id', 'major', 'minor', 'patch'], 'uq_versions_software_semver')
      table.index(
        ['software_id', 'is_active', 'major', 'minor', 'patch'],
        'idx_versions_software_semver'
      )
    })
  }

  async down() {
    const duplicates = await this.db
      .from('versions')
      .select('major', 'minor', 'patch')
      .count('* as total')
      .groupBy('major', 'minor', 'patch')
      .having('total', '>', 1)
      .first()

    if (duplicates) {
      throw new Error(
        'Cannot roll back software products while different products contain the same semantic version. Export or reconcile those versions first.'
      )
    }

    this.schema.alterTable('versions', (table) => {
      table.dropForeign(['software_id'])
    })

    this.schema.alterTable('versions', (table) => {
      table.dropIndex(
        ['software_id', 'is_active', 'major', 'minor', 'patch'],
        'idx_versions_software_semver'
      )
      table.dropUnique(['software_id', 'major', 'minor', 'patch'], 'uq_versions_software_semver')
      table.unique(['major', 'minor', 'patch'], 'unique_m_m_p')
    })

    this.schema.alterTable('versions', (table) => {
      table.dropColumn('software_id')
    })
    this.schema.dropTable('software')
  }
}

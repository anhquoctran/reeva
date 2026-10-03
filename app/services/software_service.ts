import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import SoftwareRepository from '#repositories/software_repository'
import Software from '#models/software'

const MAX_SLUG_LENGTH = 80

function createSafeSlug(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')

  return slug || 'software'
}

@inject()
export default class SoftwareService {
  constructor(protected softwareRepository: SoftwareRepository) {}

  async getAll() {
    return this.softwareRepository.query().orderBy('isDefault', 'desc').orderBy('name', 'asc')
  }

  async getDefault() {
    const software = await this.softwareRepository.findDefault()
    if (!software) throw new Error('Default software is not configured.')
    return software
  }

  async resolvePublic(slug?: string) {
    return slug
      ? this.softwareRepository.findActiveBySlug(slug)
      : this.softwareRepository.findActiveDefault()
  }

  async create(data: Record<string, unknown>) {
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (!name || name.length > 120) throw new Error('Name must be between 1 and 120 characters.')
    const baseSlug = createSafeSlug(name)

    return db.transaction(async (trx) => {
      // Serialize slug allocation so simultaneous products with the same name
      // receive different slugs before the unique database constraint is hit.
      await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 3)')

      let slug = baseSlug
      let suffix = 1
      while (await trx.from('software').where('slug', slug).first()) {
        suffix++
        const suffixText = `-${suffix}`
        const prefix = baseSlug.slice(0, MAX_SLUG_LENGTH - suffixText.length).replace(/-+$/g, '')
        slug = `${prefix}${suffixText}`
      }

      return Software.create(
        {
          name,
          slug,
          isActive: true,
          isDefault: false,
        },
        { client: trx }
      )
    })
  }

  async toggleActive(id: string) {
    return db.transaction(async (trx) => {
      const software = await trx.from('software').where('id', id).forUpdate().first()
      if (!software) throw new Error('Software not found.')
      if (software.is_default && software.is_active) {
        throw new Error('The default software cannot be deactivated. Choose another default first.')
      }

      await trx.from('software').where('id', id).update({ is_active: !software.is_active })
      return Software.query({ client: trx }).where('id', id).firstOrFail()
    })
  }

  async updateName(id: string, input: unknown) {
    const name = typeof input === 'string' ? input.trim() : ''
    if (!name || name.length > 120) throw new Error('Name must be between 1 and 120 characters.')
    const software = await this.softwareRepository.findById(id)
    software.name = name
    await software.save()
    return software
  }

  async setDefault(id: string) {
    return db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 1)')
      const activeRows = await trx.from('software').where('is_active', true).forUpdate()
      const target = activeRows.find((row) => row.id === id)
      if (!target) throw new Error('Only active software can be the default.')

      await trx.from('software').update({ is_default: false })
      await trx.from('software').where('id', id).update({ is_default: true })
      return Software.query({ client: trx }).where('id', id).firstOrFail()
    })
  }
}

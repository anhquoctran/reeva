import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import SoftwareRepository from '#repositories/software_repository'
import Software from '#models/software'

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
    const slug = typeof data.slug === 'string' ? data.slug.trim() : ''
    if (!name || name.length > 120) throw new Error('Name must be between 1 and 120 characters.')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new Error('Slug must use lowercase letters, numbers, and single hyphens.')
    }
    if (await this.softwareRepository.findBySlug(slug)) {
      throw new Error('That software slug is already in use.')
    }

    return db.transaction(async (trx) => {
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
      const activeRows = await trx.from('software').where('is_active', true).forUpdate()
      const target = activeRows.find((row) => row.id === id)
      if (!target) throw new Error('Only active software can be the default.')

      await trx.from('software').update({ is_default: false })
      await trx.from('software').where('id', id).update({ is_default: true })
      return Software.query({ client: trx }).where('id', id).firstOrFail()
    })
  }
}

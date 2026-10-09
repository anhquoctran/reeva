import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import SoftwareRepository from '#repositories/software_repository'
import Software from '#models/software'
import SoftwareSigningKey from '#models/software_signing_key'
import Artifact from '#models/artifact'
import ManagedSignerService from '#services/managed_signer_service'
import {
  createOtaReleasePayload,
  validateOtaPublicKey,
  verifyOtaReleaseSignature,
} from '#services/ota_release_signature_service'

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

  async getAllWithSigningKeys(keyword: string = '', page: number = 1) {
    let q = this.softwareRepository
      .query()
      .preload('signingKeys', (query) => query.orderBy('createdAt', 'asc'))
      .orderBy('isDefault', 'desc')
      .orderBy('name', 'asc')

    if (keyword) {
      keyword = keyword.trim().toLowerCase()
      q = q.whereILike('name', `%${keyword}%`)
    }

    return await q.paginate(page)
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

  async addSigningKey(softwareId: string, input: unknown) {
    const software = await this.softwareRepository.findById(softwareId)
    const publicKeyPem = typeof input === 'string' ? input.trim() : ''
    const key = validateOtaPublicKey(publicKeyPem)
    const existing = await SoftwareSigningKey.query().where('keyId', key.keyId).first()

    if (existing) {
      if (existing.softwareId !== software.id) {
        throw new Error('A signing key must be dedicated to one software product.')
      }
      if (!existing.isActive) throw new Error('This key was revoked and cannot be reactivated.')
      throw new Error('This public key is already registered for this software.')
    }

    return SoftwareSigningKey.create({
      softwareId: software.id,
      keyId: key.keyId,
      publicKey: key.publicKey,
      isActive: true,
    })
  }

  async importManagedSigningKey(softwareId: string) {
    const software = await this.softwareRepository.findById(softwareId)
    const key = await new ManagedSignerService().getKey(software.slug)
    return this.addSigningKey(softwareId, key.publicKey)
  }

  async setRequireSignedUpdates(softwareId: string, input: unknown) {
    const software = await this.softwareRepository.findById(softwareId)
    const required = input === true || input === 'on' || input === 'true' || input === '1'

    if (required) {
      const keys = await SoftwareSigningKey.query()
        .where('softwareId', software.id)
        .where('isActive', true)
      if (keys.length === 0)
        throw new Error('Add an active Ed25519 public key before enabling signatures.')

      const artifacts = await Artifact.query()
        .where('isPublished', true)
        .where('isArchived', false)
        .whereHas('version', (query) =>
          query.where('softwareId', software.id).where('isActive', true)
        )
        .preload('version', (query) => query.preload('software'))
        .preload('platform')
        .preload('architecture')

      const keysById = new Map(keys.map((key) => [key.keyId, key.publicKey] as const))
      for (const artifact of artifacts) {
        const keyId = artifact.signatureKeyId
        const publicKey = keyId ? keysById.get(keyId) : undefined
        const payload = createOtaReleasePayload(artifact)
        if (
          !artifact.signature ||
          !publicKey ||
          !verifyOtaReleaseSignature(payload, artifact.signature, publicKey)
        ) {
          throw new Error(
            `Sign and verify every published release before enabling signed updates. Missing or invalid signature: ${artifact.fileName}.`
          )
        }
      }
    }

    software.requireSignedUpdates = required
    await software.save()
    return software
  }

  async revokeSigningKey(softwareId: string, keyId: string) {
    const software = await this.softwareRepository.findById(softwareId)
    if (!/^[a-f0-9]{64}$/.test(keyId)) throw new Error('Invalid signing key identifier.')
    const key = await SoftwareSigningKey.query()
      .where('softwareId', software.id)
      .where('keyId', keyId)
      .where('isActive', true)
      .first()
    if (!key) throw new Error('Active signing key not found.')

    if (software.requireSignedUpdates) {
      const activeKeyCount = await SoftwareSigningKey.query()
        .where('softwareId', software.id)
        .where('isActive', true)
        .count('* as total')
      if (Number(activeKeyCount[0].$extras.total) <= 1) {
        throw new Error('Register a replacement public key before revoking the last active key.')
      }

      const usedByPublishedArtifact = await Artifact.query()
        .where('signatureKeyId', keyId)
        .where('isPublished', true)
        .where('isArchived', false)
        .whereHas('version', (query) =>
          query.where('softwareId', software.id).where('isActive', true)
        )
        .first()
      if (usedByPublishedArtifact) {
        throw new Error(
          'Re-sign or archive published releases with another active key before revoking this key.'
        )
      }
    }

    key.isActive = false
    await key.save()
    await Artifact.query()
      .where('signatureKeyId', keyId)
      .whereHas('version', (query) => query.where('softwareId', software.id))
      .update({ signature: null, signatureKeyId: null, signatureManifest: null })
    return key
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

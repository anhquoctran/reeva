import { inject } from '@adonisjs/core'
import LicenseRepository from '#repositories/license_repository'
import { DateTime } from 'luxon'
import crypto from 'node:crypto'
import LicenseActivation from '#models/license_activation'
import Setting from '#models/setting'
import License from '#models/license'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

@inject()
export default class LicenseService {
  constructor(protected licenseRepository: LicenseRepository) {}

  async getFilteredLicenses(page: number, limit: number, filters: any) {
    const query = this.licenseRepository.query().orderBy('createdAt', 'desc')

    if (filters.licenseKey) {
      query.where('licenseKey', 'ilike', `%${filters.licenseKey}%`)
    }

    if (filters.customer) {
      query.where((q) => {
        q.where('customerName', 'ilike', `%${filters.customer}%`).orWhere(
          'customerEmail',
          'ilike',
          `%${filters.customer}%`
        )
      })
    }

    if (filters.productName) {
      query.where('productName', 'ilike', `%${filters.productName}%`)
    }

    if (filters.status) {
      query.where('status', filters.status)
    }

    return await query.paginate(page, limit)
  }

  async getLicense(id: string | number) {
    return await this.licenseRepository.findById(id)
  }

  async createLicense(data: any) {
    const maxActivations = data.maxActivations ? Number.parseInt(data.maxActivations) : 1
    return await this.licenseRepository.create({
      licenseKey: data.licenseKey || undefined,
      productName: data.productName,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      status: data.status || 'active',
      maxActivations: Number.isNaN(maxActivations) ? 1 : maxActivations,
      expiresAt: data.expiresAt ? DateTime.fromISO(data.expiresAt) : null,
    })
  }

  async updateLicense(id: string | number, data: any) {
    return db.transaction(async (trx) => {
      const license = await License.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      const maxActivations = data.maxActivations
        ? Number.parseInt(data.maxActivations)
        : license.maxActivations

      license.merge({
        licenseKey: data.licenseKey,
        productName: data.productName,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        status: data.status,
        maxActivations: Number.isNaN(maxActivations) ? license.maxActivations : maxActivations,
        expiresAt: data.expiresAt ? DateTime.fromISO(data.expiresAt) : null,
        revokedAt:
          data.status === 'revoked' && !license.revokedAt ? DateTime.now() : license.revokedAt,
      })

      if (data.status !== 'revoked') {
        license.revokedAt = null
      }

      await license.save()
      return license
    })
  }

  async toggleLicense(id: string | number) {
    return db.transaction(async (trx) => {
      const license = await License.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      license.status = license.status === 'active' ? 'inactive' : 'active'
      await license.save()
      return license
    })
  }

  async deleteLicense(id: string | number) {
    return db.transaction(async (trx) => {
      const license = await License.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      await license.delete()
      return license
    })
  }

  /**
   * Activation Logic
   */

  async getActivations(licenseId: string) {
    return await LicenseActivation.query()
      .where('licenseId', licenseId)
      .orderBy('createdAt', 'desc')
  }

  async issueActivationToken(licenseId: string, machineId: string) {
    if (typeof machineId !== 'string' || !machineId.trim() || machineId.length > 255) {
      throw new Error('Machine ID is required and must be 255 characters or fewer')
    }
    machineId = machineId.trim()
    return db.transaction(async (trx) => {
      const license = await License.query({ client: trx })
        .where('id', licenseId)
        .forUpdate()
        .firstOrFail()
      if (license.status !== 'active') throw new Error('License is not active')
      if (license.expiresAt && license.expiresAt <= DateTime.utc())
        throw new Error('License has expired')
      const activations = await LicenseActivation.query({ client: trx }).where(
        'licenseId',
        license.id
      )
      if (activations.some((activation) => activation.machineId === machineId)) {
        throw new Error('This machine is already activated for this license')
      }
      if (activations.length >= license.maxActivations) throw new Error('Activation limit reached')
      const payload = {
        lid: license.id,
        key: license.licenseKey,
        hid: machineId,
        prod: license.productName,
        exp: license.expiresAt ? license.expiresAt.toMillis() : null,
        iat: Date.now(),
      }
      const privateKey = await this.getPrivateKey(trx)
      const signature = crypto.sign(undefined, Buffer.from(JSON.stringify(payload)), privateKey)
      const token = Buffer.from(
        JSON.stringify({ p: payload, s: signature.toString('base64') })
      ).toString('base64')
      await LicenseActivation.create({ licenseId: license.id, machineId }, { client: trx })
      license.activationCount = activations.length + 1
      await license.save()
      return token
    })
  }

  async removeActivation(licenseId: string, activationId: string) {
    await db.transaction(async (trx) => {
      const license = await License.query({ client: trx })
        .where('id', licenseId)
        .forUpdate()
        .firstOrFail()
      const activation = await LicenseActivation.query({ client: trx })
        .where('id', activationId)
        .where('licenseId', license.id)
        .firstOrFail()
      await activation.delete()
      const count = await LicenseActivation.query({ client: trx })
        .where('licenseId', license.id)
        .count('* as total')
        .first()
      license.activationCount = Number(count?.$extras.total || 0)
      await license.save()
    })
  }

  private async getPrivateKey(trx: TransactionClientContract) {
    // Serialize first-time key creation across every app instance and license.
    await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 3)')
    let keySetting = await Setting.query({ client: trx })
      .where('key', 'license_private_key')
      .first()
    if (!keySetting) {
      const { privateKey } = crypto.generateKeyPairSync('ed25519')
      const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
      keySetting = await Setting.create(
        { key: 'license_private_key', value: privateKeyPem },
        { client: trx }
      )
      const publicKeyPem = crypto
        .createPublicKey(privateKey)
        .export({ type: 'spki', format: 'pem' })
        .toString()
      await Setting.updateOrCreate(
        { key: 'license_public_key' },
        { value: publicKeyPem },
        { client: trx }
      )
    }
    return crypto.createPrivateKey(keySetting.value!)
  }
}

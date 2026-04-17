import { inject } from '@adonisjs/core'
import LicenseRepository from '#repositories/license_repository'
import { DateTime } from 'luxon'
import crypto from 'node:crypto'
import LicenseActivation from '#models/license_activation'
import License from '#models/license'

@inject()
export default class LicenseService {
  constructor(protected licenseRepository: LicenseRepository) {}

  async getFilteredLicenses(page: number, limit: number, filters: any) {
    const query = this.licenseRepository.query().orderBy('createdAt', 'desc')

    if (filters.licenseKey) {
      query.where('licenseKey', 'like', `%${filters.licenseKey}%`)
    }

    if (filters.customer) {
      query.where((q) => {
        q.where('customerName', 'like', `%${filters.customer}%`)
          .orWhere('customerEmail', 'like', `%${filters.customer}%`)
      })
    }

    if (filters.productName) {
      query.where('productName', 'like', `%${filters.productName}%`)
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
      maxActivations: isNaN(maxActivations) ? 1 : maxActivations,
      expiresAt: data.expiresAt ? DateTime.fromISO(data.expiresAt) : null,
    })
  }

  async updateLicense(id: string | number, data: any) {
    const license = await this.licenseRepository.findById(id)
    const maxActivations = data.maxActivations ? Number.parseInt(data.maxActivations) : license.maxActivations
    
    license.merge({
      licenseKey: data.licenseKey,
      productName: data.productName,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      status: data.status,
      maxActivations: isNaN(maxActivations) ? license.maxActivations : maxActivations,
      expiresAt: data.expiresAt ? DateTime.fromISO(data.expiresAt) : null,
      revokedAt: data.status === 'revoked' && !license.revokedAt ? DateTime.now() : license.revokedAt
    })

    if (data.status !== 'revoked') {
      license.revokedAt = null
    }

    return await this.licenseRepository.update(license)
  }

  async toggleLicense(id: string | number) {
    const license = await this.licenseRepository.findById(id)
    license.status = license.status === 'active' ? 'inactive' : 'active'
    return await this.licenseRepository.update(license)
  }

  async deleteLicense(id: string | number) {
    const license = await this.licenseRepository.findById(id)
    await this.licenseRepository.delete(license)
    return license
  }

  /**
   * Activation Logic
   */

  async getActivations(licenseId: string) {
    return await LicenseActivation.query().where('licenseId', licenseId).orderBy('createdAt', 'desc')
  }

  async issueActivationToken(licenseId: string, machineId: string) {
    const license = await this.licenseRepository.findById(licenseId)
    
    if (license.status !== 'active') throw new Error('License is not active')
    if (license.activationCount >= license.maxActivations) throw new Error('Activation limit reached')
    
    const existing = await LicenseActivation.query()
      .where('licenseId', license.id)
      .where('machineId', machineId)
      .first()
      
    if (existing) throw new Error('This machine is already activated for this license')
    
    // Generate Token
    const payload = {
      lid: license.id,
      key: license.licenseKey,
      hid: machineId,
      prod: license.productName,
      exp: license.expiresAt ? license.expiresAt.toMillis() : null,
      iat: Date.now()
    }
    
    const privateKey = await this.getPrivateKey()
    const signature = crypto.sign(undefined, Buffer.from(JSON.stringify(payload)), privateKey)
    
    const token = Buffer.from(JSON.stringify({
      p: payload,
      s: signature.toString('base64')
    })).toString('base64')
    
    // Create activation record
    await LicenseActivation.create({
      licenseId: license.id,
      machineId: machineId
    })
    
    license.activationCount++
    await license.save()
    
    return token
  }

  async removeActivation(licenseId: string, activationId: string) {
    const activation = await LicenseActivation.findOrFail(activationId)
    const license = await this.licenseRepository.findById(licenseId)
    
    await activation.delete()
    
    license.activationCount = Math.max(0, license.activationCount - 1)
    await license.save()
  }

  private async getPrivateKey() {
    const Setting = (await import('#models/setting')).default
    let keySetting = await Setting.query().where('key', 'license_private_key').first()
    
    if (!keySetting) {
      const { privateKey } = crypto.generateKeyPairSync('ed25519')
      const privateKeyBase64 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
      keySetting = await Setting.create({ 
        key: 'license_private_key', 
        value: privateKeyBase64 
      })
      
      // Also save public key for convenience
      const publicKey = crypto.createPublicKey(privateKey)
      const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
      await Setting.create({ key: 'license_public_key', value: publicKeyPem })
    }
    
    return crypto.createPrivateKey(keySetting.value!)
  }
}

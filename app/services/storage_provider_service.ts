import { inject } from '@adonisjs/core'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import db from '@adonisjs/lucid/services/db'
import StorageProvider from '#models/storage_provider'
import path from 'node:path'
import { normalizeS3CompatibleConfig } from '#services/storage/s3_compatible_config'

const S3_DRIVERS = new Set(['s3', 'minio', 'seaweedfs', 'oci', 'r2'])
const GB_IN_BYTES = 1024 * 1024 * 1024

type ProviderInput = Record<string, unknown>

function inputString(value: unknown, label: string, maxLength = 4096) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${label} must be a string of ${maxLength} characters or fewer.`)
  }
  return value.trim()
}

function isChecked(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

function validateProviderName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new Error('Provider name is required and must be 100 characters or fewer.')
  }
  return value.trim()
}

function quotaInBytes(value: unknown) {
  const quota = Number(value)
  if (!Number.isFinite(quota) || quota < 0 || quota > 1_000_000) {
    throw new Error('Storage quota must be a non-negative finite GB value.')
  }
  return Math.round(quota * GB_IN_BYTES)
}

function providerDriver(provider: StorageProvider) {
  const config = provider.config || {}
  const configured = config.driver
  if (typeof configured === 'string' && configured.trim()) return configured.trim().toLowerCase()
  return provider.type.toLowerCase()
}

function normalizedProviderConfig(
  driver: string,
  input: ProviderInput,
  existing?: Record<string, unknown>
) {
  if (driver === 'local') {
    const root = inputString(input.root ?? existing?.root, 'Storage root', 2048)
    if (!root || !path.isAbsolute(root)) {
      throw new Error('Local storage root must be an absolute path.')
    }
    return { driver: 'local', root }
  }

  if (!S3_DRIVERS.has(driver)) throw new Error('Unsupported storage provider driver.')

  const enteredAccessKey = inputString(input.accessKeyId, 'Access key ID', 512)
  const enteredSecretKey = inputString(input.secretAccessKey, 'Secret access key', 4096)
  const clearCredentials = isChecked(input.clearCredentials)
  const clearSessionToken = isChecked(input.clearSessionToken)
  if (clearCredentials && (enteredAccessKey || enteredSecretKey)) {
    throw new Error('Leave credential fields empty when clearing stored credentials.')
  }
  if (!clearCredentials && Boolean(enteredAccessKey) !== Boolean(enteredSecretKey)) {
    throw new Error('Enter both access key ID and secret access key to replace credentials.')
  }

  const config: Record<string, unknown> = {
    driver,
    bucket: inputString(input.bucket ?? existing?.bucket, 'Bucket name', 255),
    region: inputString(input.region ?? existing?.region, 'Region', 100) || 'us-east-1',
    endpoint: inputString(input.endpoint ?? existing?.endpoint, 'Endpoint', 2048) || undefined,
    forcePathStyle:
      inputString(input.forcePathStyle ?? existing?.forcePathStyle, 'Path style', 16) || 'auto',
    maxAttempts: input.maxAttempts ?? existing?.maxAttempts,
    connectionTimeoutMs: input.connectionTimeoutMs ?? existing?.connectionTimeoutMs,
    socketTimeoutMs: input.socketTimeoutMs ?? existing?.socketTimeoutMs,
    downloadUrlTtlSeconds: input.downloadUrlTtlSeconds ?? existing?.downloadUrlTtlSeconds,
  }

  const accessKeyId = clearCredentials
    ? undefined
    : enteredAccessKey || existing?.accessKeyId || existing?.accessKey
  const secretAccessKey = clearCredentials
    ? undefined
    : enteredSecretKey || existing?.secretAccessKey || existing?.secretKey
  const enteredSessionToken = inputString(input.sessionToken, 'Session token', 4096)
  const sessionToken =
    clearCredentials || clearSessionToken
      ? undefined
      : enteredSessionToken || existing?.sessionToken

  if (accessKeyId !== undefined) config.accessKeyId = accessKeyId
  if (secretAccessKey !== undefined) config.secretAccessKey = secretAccessKey
  if (sessionToken !== undefined) config.sessionToken = sessionToken

  const normalized = normalizeS3CompatibleConfig(config, driver)
  return { driver, ...normalized }
}

function safeProviderConfig(provider: StorageProvider) {
  const config = provider.config || {}
  const driver = providerDriver(provider)
  let endpoint = typeof config.endpoint === 'string' ? config.endpoint : ''
  if (endpoint && !/^[a-z][a-z\d+.-]*:\/\//i.test(endpoint)) {
    const port =
      typeof config.port === 'number' || typeof config.port === 'string' ? `:${config.port}` : ''
    endpoint = `${config.useSSL === true || config.useSSL === 'true' ? 'https' : 'http'}://${endpoint}${port}`
  }
  return {
    driver,
    root: typeof config.root === 'string' ? config.root : '',
    endpoint,
    bucket: typeof config.bucket === 'string' ? config.bucket : '',
    region: typeof config.region === 'string' ? config.region : 'us-east-1',
    forcePathStyle:
      typeof config.forcePathStyle === 'boolean' || typeof config.forcePathStyle === 'string'
        ? config.forcePathStyle
        : 'auto',
    maxAttempts: config.maxAttempts ?? 3,
    connectionTimeoutMs: config.connectionTimeoutMs ?? 10_000,
    socketTimeoutMs: config.socketTimeoutMs ?? 120_000,
    downloadUrlTtlSeconds: config.downloadUrlTtlSeconds ?? 3600,
    credentialsConfigured:
      Boolean(config.accessKeyId || config.accessKey) &&
      Boolean(config.secretAccessKey || config.secretKey),
    sessionTokenConfigured: Boolean(config.sessionToken),
  }
}

@inject()
export default class StorageProviderService {
  constructor(protected storageProviderRepository: StorageProviderRepository) {}

  async getPaginatedProviders(page: number, limit: number) {
    return await this.storageProviderRepository
      .query()
      .orderBy('isDefault', 'desc')
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)
  }

  async getDefaultProvider() {
    return await StorageProvider.query().where('isDefault', true).first()
  }

  async getUsageStats(provider: StorageProvider) {
    const usageResult = await db
      .from('artifacts')
      .where('storage_provider_id', provider.id)
      .sum({ totalUsage: 'size_bytes' })
      .first()

    const currentUsage = Number(usageResult?.totalUsage || 0)
    const quota = Number(provider.quotaBytes || 0)
    const usagePercentage = quota > 0 ? Math.min((currentUsage / quota) * 100, 100) : 0

    return { currentUsage, usagePercentage }
  }

  async activateProvider(id: string | number) {
    await db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(1919247734, 2)')
      const provider = await StorageProvider.findOrFail(id, { client: trx })
      const driver = providerDriver(provider)
      if (driver === 'local') {
        if (typeof provider.config?.root !== 'string' || !path.isAbsolute(provider.config.root)) {
          throw new Error(
            'Configure a valid absolute local storage root before activating this provider.'
          )
        }
      } else {
        if (!S3_DRIVERS.has(driver)) throw new Error('Unsupported storage provider driver.')
        normalizeS3CompatibleConfig(provider.config, driver)
      }
      await StorageProvider.query({ client: trx }).update({ isDefault: false })
      provider.isActive = true
      provider.isDefault = true
      await provider.useTransaction(trx).save()
    })
  }

  async getProvider(id: string | number) {
    return await this.storageProviderRepository.findById(id)
  }

  getProviderEditView(provider: StorageProvider) {
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      quotaGb: Number(provider.quotaBytes || 0) / GB_IN_BYTES,
      config: safeProviderConfig(provider),
    }
  }

  async createProvider(input: ProviderInput) {
    const name = validateProviderName(input.name)
    const driver = inputString(input.driver, 'Provider driver', 32).toLowerCase()
    if (driver !== 'local' && !S3_DRIVERS.has(driver)) {
      throw new Error('Choose a supported local or S3-compatible storage provider.')
    }
    const config = normalizedProviderConfig(driver, input)
    const type =
      driver === 'local'
        ? 'local'
        : ['minio', 'seaweedfs'].includes(driver)
          ? 'self-hosted'
          : 'cloud'
    return StorageProvider.create({
      name,
      type,
      config,
      isDefault: false,
      isActive: true,
      quotaBytes: quotaInBytes(input.quotaGb ?? 10),
    })
  }

  async updateProvider(id: string | number, input: ProviderInput) {
    const provider = await this.storageProviderRepository.findById(id)
    const name = validateProviderName(input.name)
    const driver = providerDriver(provider)
    provider.name = name
    provider.config = normalizedProviderConfig(driver, input, provider.config)
    provider.quotaBytes = quotaInBytes(input.quotaGb)
    await provider.save()
    return provider
  }
}

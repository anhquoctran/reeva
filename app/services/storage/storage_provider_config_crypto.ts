import encryption from '@adonisjs/core/services/encryption'

export const STORAGE_PROVIDER_CONFIG_PURPOSE = 'reeva:storage-provider-config:v1'
const ENVELOPE_KEY = '__reevaStorageProviderConfig'
const ENVELOPE_VERSION = 1

export type EncryptedStorageProviderConfig = {
  [ENVELOPE_KEY]: typeof ENVELOPE_VERSION
  payload: string
}

export function isEncryptedStorageProviderConfig(
  value: unknown
): value is EncryptedStorageProviderConfig {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[ENVELOPE_KEY] === ENVELOPE_VERSION &&
    typeof (value as Record<string, unknown>).payload === 'string'
  )
}

export function encryptStorageProviderConfig(value: Record<string, unknown>) {
  return {
    [ENVELOPE_KEY]: ENVELOPE_VERSION,
    payload: encryption.encrypt(value, { purpose: STORAGE_PROVIDER_CONFIG_PURPOSE }),
  } satisfies EncryptedStorageProviderConfig
}

export function decryptStorageProviderConfig(value: unknown): Record<string, unknown> {
  if (!isEncryptedStorageProviderConfig(value)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Plain configs are accepted for the additive migration and old imported rows.
      return value as Record<string, unknown>
    }
    throw new Error('Storage provider configuration in the database is invalid.')
  }

  const decrypted = encryption.decrypt<Record<string, unknown>>(
    value.payload,
    STORAGE_PROVIDER_CONFIG_PURPOSE
  )
  if (!decrypted || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
    throw new Error(
      'Cannot decrypt storage provider configuration. Check APP_KEY consistency across Reeva instances.'
    )
  }
  return decrypted
}

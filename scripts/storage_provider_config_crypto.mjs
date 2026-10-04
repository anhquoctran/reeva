import { Encryption } from '@adonisjs/core/encryption'
import { AES256GCM } from '@adonisjs/core/encryption/drivers/aes_256_gcm'

export const STORAGE_CONFIG_PURPOSE = 'reeva:storage-provider-config:v1'

export function createStorageConfigEncryptor(appKey) {
  if (typeof appKey !== 'string' || !appKey) {
    throw new Error('APP_KEY is required to encrypt storage provider configuration.')
  }
  const encryption = new Encryption({
    driver: (key) => new AES256GCM({ id: 'gcm', key }),
    keys: [appKey],
  })
  return {
    encrypt(config) {
      return {
        __reevaStorageProviderConfig: 1,
        payload: encryption.encrypt(config, { purpose: STORAGE_CONFIG_PURPOSE }),
      }
    },
    decrypt(envelope) {
      if (
        !envelope ||
        envelope.__reevaStorageProviderConfig !== 1 ||
        typeof envelope.payload !== 'string'
      ) {
        throw new Error('Invalid encrypted storage provider configuration.')
      }
      return encryption.decrypt(envelope.payload, STORAGE_CONFIG_PURPOSE)
    },
  }
}

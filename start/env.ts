/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

const env = await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number.optional(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  APP_GIT_SHA: Env.schema.string.optional(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'database'] as const),

  // Database
  DB_CONNECTION: Env.schema.enum.optional(['pg'] as const),
  DB_HOST: Env.schema.string.optional({ format: 'host' }),
  DB_PORT: Env.schema.number.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_PASSWORD_FILE: Env.schema.string.optional(),
  DB_SSL: (key, value) => {
    if (!value) return false
    if (!['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`)
    return value === 'true'
  },
  DB_SSL_CA_PATH: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),

  // Deprecated S3_* values are read only by the one-time migration from legacy
  // environment-backed provider records. New provider configuration is DB managed.
  S3_ENDPOINT: Env.schema.string.optional(),
  S3_REGION: Env.schema.string.optional(),
  S3_BUCKET: Env.schema.string.optional(),
  S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  S3_SECRET_ACCESS_KEY: Env.schema.string.optional(),
  S3_SESSION_TOKEN: Env.schema.string.optional(),
  S3_FORCE_PATH_STYLE: Env.schema.string.optional(),
  S3_MAX_ATTEMPTS: Env.schema.number.optional(),
  S3_CONNECTION_TIMEOUT_MS: Env.schema.number.optional(),
  S3_SOCKET_TIMEOUT_MS: Env.schema.number.optional(),
  S3_DOWNLOAD_URL_TTL_SECONDS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  MAIL_MAILER: Env.schema.enum(['smtp'] as const),
  MAIL_ENABLED: Env.schema.boolean.optional(),
  MAIL_FROM_NAME: Env.schema.string(),
  MAIL_FROM_ADDRESS: Env.schema.string(),
  SMTP_HOST: Env.schema.string(),
  SMTP_PORT: Env.schema.number(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
  SMTP_SECURE: Env.schema.boolean.optional(),
  TRUSTED_PROXIES: Env.schema.string.optional(),
  MAX_UPLOAD_SIZE: Env.schema.string.optional(),
  SIGNER_URL: Env.schema.string.optional(),
  SIGNER_CA_FILE: Env.schema.string.optional(),
  SIGNER_REQUESTER_TOKEN_FILE: Env.schema.string.optional(),
  ADMIN_EMAIL: Env.schema.string.optional(),
  ADMIN_PASSWORD: Env.schema.string.optional(),
})

const configuredPort = env.get('PORT')
if (configuredPort === undefined) {
  // Keep direct starts aligned with PM2 and container defaults.
  process.env.PORT = '8888'
} else if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.')
}

const configuredS3PathStyle = env.get('S3_FORCE_PATH_STYLE')
if (configuredS3PathStyle && !['auto', 'true', 'false'].includes(configuredS3PathStyle)) {
  throw new Error('S3_FORCE_PATH_STYLE must be auto, true, or false.')
}

// Only the additive legacy migration reads these. Keep them out of the long-
// running server's inherited process environment after Env has captured them.
for (const key of [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_SESSION_TOKEN',
  'S3_FORCE_PATH_STYLE',
  'S3_MAX_ATTEMPTS',
  'S3_CONNECTION_TIMEOUT_MS',
  'S3_SOCKET_TIMEOUT_MS',
  'S3_DOWNLOAD_URL_TTL_SECONDS',
  'STORAGE_DRIVER',
]) {
  delete process.env[key]
}

export default env

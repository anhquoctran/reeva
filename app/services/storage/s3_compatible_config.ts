export type S3CompatibleConfig = {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  forcePathStyle: boolean
  maxAttempts: number
  connectionTimeoutMs: number
  socketTimeoutMs: number
  downloadUrlTtlSeconds: number
}

type ConfigRecord = Record<string, unknown>

function asRecord(value: unknown): ConfigRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('S3 storage configuration must be an object.')
  }

  return value as ConfigRecord
}

function asOptionalString(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string when configured.`)
  }
  return value.trim()
}

function asPositiveInteger(value: unknown, fallback: number, name: string, max: number) {
  if (value === undefined || value === null || value === '') return fallback
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}.`)
  }
  return numberValue
}

function normalizeEndpoint(
  value: string | undefined,
  options: { legacyHost?: boolean; port?: unknown; useSSL?: unknown }
) {
  if (!value) return undefined

  let endpointValue = value
  if (options.legacyHost && !/^[a-z][a-z\d+.-]*:\/\//i.test(endpointValue)) {
    const useSSL = options.useSSL === true || options.useSSL === 'true'
    const portValue = options.port
    const port =
      typeof portValue === 'number' || typeof portValue === 'string' ? String(portValue) : undefined
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      throw new Error('Storage endpoint port must be an integer between 1 and 65535.')
    }
    endpointValue = `${useSSL ? 'https' : 'http'}://${endpointValue}${port ? `:${port}` : ''}`
  }

  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    throw new Error('S3_ENDPOINT must be a valid HTTP or HTTPS URL.')
  }

  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('S3_ENDPOINT must use HTTP or HTTPS without credentials, query, or fragment.')
  }

  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '')
  return endpoint.toString().replace(/\/$/, '')
}

function parsePathStyle(value: unknown, endpoint: string | undefined, legacyDriver: string) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  if (value === undefined || value === null || value === '' || value === 'auto') {
    return legacyDriver === 'minio' || legacyDriver === 'seaweedfs' || Boolean(endpoint)
  }
  throw new Error('S3_FORCE_PATH_STYLE must be one of auto, true, or false.')
}

/** Normalize current CMS JSON and legacy MinIO/SeaweedFS provider records. */
export function normalizeS3CompatibleConfig(input: unknown, driver = 's3'): S3CompatibleConfig {
  const value = asRecord(input)
  const bucket = asOptionalString(value.bucket, 'S3_BUCKET')
  if (!bucket || bucket.includes('/') || bucket.includes('\\') || /\s/.test(bucket)) {
    throw new Error('S3_BUCKET is required and cannot contain path separators or whitespace.')
  }

  const endpointValue = asOptionalString(value.endpoint, 'S3_ENDPOINT')
  const endpoint = normalizeEndpoint(endpointValue, {
    legacyHost: driver === 'minio' || driver === 'seaweedfs',
    port: value.port,
    useSSL: value.useSSL,
  })

  const accessKeyId = asOptionalString(value.accessKeyId ?? value.accessKey, 'S3_ACCESS_KEY_ID')
  const secretAccessKey = asOptionalString(
    value.secretAccessKey ?? value.secretKey,
    'S3_SECRET_ACCESS_KEY'
  )
  const sessionToken = asOptionalString(value.sessionToken, 'S3_SESSION_TOKEN')
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.')
  }
  if (sessionToken && !accessKeyId) {
    throw new Error('S3_SESSION_TOKEN requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.')
  }

  const region = asOptionalString(value.region, 'S3_REGION') || 'us-east-1'
  const maxAttempts = asPositiveInteger(value.maxAttempts, 3, 'S3_MAX_ATTEMPTS', 10)
  const connectionTimeoutMs = asPositiveInteger(
    value.connectionTimeoutMs,
    10_000,
    'S3_CONNECTION_TIMEOUT_MS',
    120_000
  )
  const socketTimeoutMs = asPositiveInteger(
    value.socketTimeoutMs,
    120_000,
    'S3_SOCKET_TIMEOUT_MS',
    600_000
  )
  const downloadUrlTtlSeconds = asPositiveInteger(
    value.downloadUrlTtlSeconds,
    3600,
    'S3_DOWNLOAD_URL_TTL_SECONDS',
    604800
  )

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    forcePathStyle: parsePathStyle(value.forcePathStyle, endpoint, driver),
    maxAttempts,
    connectionTimeoutMs,
    socketTimeoutMs,
    downloadUrlTtlSeconds,
  }
}

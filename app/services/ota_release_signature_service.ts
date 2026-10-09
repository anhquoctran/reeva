import { createHash, createPublicKey, verify } from 'node:crypto'
import type Artifact from '#models/artifact'

export type OtaReleaseManifest = {
  schemaVersion: 1
  software: string
  version: string
  codename: string | null
  changelog: string | null
  channel: string
  platform: string
  architecture: string
  fileName: string
  sizeBytes: number
  sha256: string
}

export type OtaSignatureEnvelope = {
  payload: string
  signature: string
  keyId: string
}

function getPublicKey(publicKeyPem: string) {
  const key = createPublicKey(publicKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('OTA release keys must use Ed25519.')
  }
  return key
}

export function getOtaSigningKeyId(publicKeyPem: string) {
  const publicKey = getPublicKey(publicKeyPem)
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return createHash('sha256').update(der).digest('hex')
}

export function validateOtaPublicKey(publicKeyPem: unknown) {
  if (typeof publicKeyPem !== 'string' || publicKeyPem.length > 4096) {
    throw new Error('Provide an Ed25519 public key in PEM format.')
  }
  const trimmed = publicKeyPem.trim()
  if (!trimmed.startsWith('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('Provide an Ed25519 public key in SPKI PEM format.')
  }
  return {
    publicKey: getPublicKey(trimmed).export({ format: 'pem', type: 'spki' }).toString(),
    keyId: getOtaSigningKeyId(trimmed),
  }
}

export function buildOtaReleaseManifest(artifact: Artifact): OtaReleaseManifest {
  const version = artifact.version
  const software = version?.software
  const platform = artifact.platform
  const architecture = artifact.architecture
  const sizeBytes = artifact.sizeBytes === null ? Number.NaN : Number(artifact.sizeBytes)
  const sha256 = artifact.checksumSha256

  if (!software || !platform || !architecture) {
    throw new Error('Release metadata is incomplete and cannot be signed.')
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Release size is missing or invalid and cannot be signed.')
  }
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('A valid SHA-256 checksum is required before signing a release.')
  }

  return {
    schemaVersion: 1,
    software: software.slug,
    version: `${version.major}.${version.minor}.${version.patch}`,
    codename: version.codename,
    changelog: version.changelog,
    channel: artifact.channel,
    platform: platform.name,
    architecture: architecture.name,
    fileName: artifact.fileName,
    sizeBytes,
    sha256,
  }
}

/**
 * The payload is a compact, UTF-8 JSON object with fixed property order. The
 * API transports the exact bytes as base64url so clients verify those bytes
 * directly instead of re-serializing JSON.
 */
export function createOtaReleasePayload(artifact: Artifact) {
  return Buffer.from(JSON.stringify(buildOtaReleaseManifest(artifact)), 'utf8').toString(
    'base64url'
  )
}

export function createOtaReleaseManifestJson(artifact: Artifact) {
  return JSON.stringify(buildOtaReleaseManifest(artifact), null, 2)
}

export function verifyOtaReleaseSignature(
  payload: string,
  signature: unknown,
  publicKeyPem: string
) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length > 120_000) return false

  const payloadBytes = Buffer.from(payload, 'base64url')
  const signatureBytes = Buffer.from(signature, 'base64url')
  if (
    signatureBytes.length !== 64 ||
    signatureBytes.toString('base64url') !== signature ||
    payloadBytes.length === 0 ||
    payloadBytes.toString('base64url') !== payload
  ) {
    return false
  }

  try {
    return verify(null, payloadBytes, getPublicKey(publicKeyPem), signatureBytes)
  } catch {
    return false
  }
}

export function createOtaSignatureEnvelope(artifact: Artifact): OtaSignatureEnvelope | null {
  if (!artifact.signature || !artifact.signatureKeyId) return null
  const manifest = buildOtaReleaseManifest(artifact)
  const snapshot = artifact.signatureManifest
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Object.entries(manifest).some(([field, value]) => snapshot[field] !== value)
  ) {
    return null
  }
  return {
    payload: createOtaReleasePayload(artifact),
    signature: artifact.signature,
    keyId: artifact.signatureKeyId,
  }
}

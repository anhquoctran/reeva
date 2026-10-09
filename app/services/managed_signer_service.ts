import { request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import env from '#start/env'
import {
  validateOtaPublicKey,
  verifyOtaReleaseSignature,
} from '#services/ota_release_signature_service'

export type ManagedSigningKey = {
  product: string
  keyVersion: number
  keyId: string
  publicKey: string
}
export type ManagedSigningRequest = ManagedSigningKey & {
  id: string
  payload: string
  payloadDigest: string
  status: 'pending' | 'signed'
  signature: string | null
  expiresAt: number
}

export function managedRequestId(product: string, keyId: string, payload: string) {
  return createHash('sha256')
    .update('reeva-signer-v1\0')
    .update(product)
    .update('\0')
    .update(keyId)
    .update('\0')
    .update(Buffer.from(payload, 'base64url'))
    .digest('hex')
}

export default class ManagedSignerService {
  get configured() {
    return Boolean(env.get('SIGNER_URL'))
  }

  private async call(path: string, body?: unknown): Promise<Record<string, unknown> | null> {
    const base = env.get('SIGNER_URL')
    const caFile = env.get('SIGNER_CA_FILE')
    const tokenFile = env.get('SIGNER_REQUESTER_TOKEN_FILE')
    if (!base || !caFile || !tokenFile) throw new Error('Managed signer is not configured.')
    const url = new URL(path, base)
    if (url.protocol !== 'https:') throw new Error('Managed signer requires HTTPS.')
    const [ca, token] = await Promise.all([readFile(caFile), readFile(tokenFile, 'utf8')])
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: bytes ? 'POST' : 'GET',
          ca,
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            ...(bytes
              ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          let length = 0
          res.on('data', (chunk: Buffer) => {
            length += chunk.length
            if (length > 262_144) {
              res.destroy()
              reject(new Error('Managed signer response exceeds the size limit.'))
              return
            }
            chunks.push(chunk)
          })
          res.on('error', () => reject(new Error('Managed signer response failed.')))
          res.on('end', () => {
            if (res.statusCode === 404) return resolve(null)
            if (res.statusCode !== 200) {
              reject(new Error('Managed signer unavailable, sealed, or request rejected.'))
              return
            }
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString())
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
              resolve(value)
            } catch {
              reject(new Error('Invalid managed signer response.'))
            }
          })
        }
      )
      const timer = setTimeout(() => req.destroy(new Error('Managed signer timeout.')), 15_000)
      req.on('close', () => clearTimeout(timer))
      req.on('error', () => reject(new Error('Managed signer connection failed or timed out.')))
      req.end(bytes)
    })
  }

  private key(value: Record<string, unknown> | null, product: string): ManagedSigningKey {
    if (
      !value ||
      value.product !== product ||
      !Number.isInteger(value.keyVersion) ||
      Number(value.keyVersion) < 1 ||
      typeof value.publicKey !== 'string'
    ) {
      throw new Error('Invalid managed signing key response.')
    }
    const publicKey = validateOtaPublicKey(value.publicKey)
    if (value.keyId !== publicKey.keyId)
      throw new Error('Managed signing key fingerprint mismatch.')
    return {
      product,
      keyVersion: Number(value.keyVersion),
      keyId: publicKey.keyId,
      publicKey: publicKey.publicKey,
    }
  }

  async getKey(product: string) {
    return this.key(await this.call(`/v1/products/${encodeURIComponent(product)}/key`), product)
  }

  private signingRequest(
    value: Record<string, unknown> | null,
    key: ManagedSigningKey,
    payload: string
  ): ManagedSigningRequest | null {
    if (value === null) return null
    const actualKey = this.key(value, key.product)
    const id = managedRequestId(key.product, key.keyId, payload)
    const payloadDigest = createHash('sha256')
      .update(Buffer.from(payload, 'base64url'))
      .digest('hex')
    if (
      actualKey.keyId !== key.keyId ||
      actualKey.keyVersion !== key.keyVersion ||
      value.id !== id ||
      value.payload !== payload ||
      value.payloadDigest !== payloadDigest ||
      !['pending', 'signed'].includes(String(value.status)) ||
      !Number.isSafeInteger(value.expiresAt)
    ) {
      throw new Error('Managed signing request does not match this release.')
    }
    if (
      value.status === 'signed' &&
      !verifyOtaReleaseSignature(payload, value.signature, key.publicKey)
    ) {
      throw new Error('Managed signer returned an invalid release signature.')
    }
    if (value.status === 'pending' && value.signature !== null) {
      throw new Error('Invalid pending signing request.')
    }
    return {
      ...actualKey,
      id,
      payload,
      payloadDigest,
      status: value.status as 'pending' | 'signed',
      signature: value.signature as string | null,
      expiresAt: Number(value.expiresAt),
    }
  }

  async createRequest(key: ManagedSigningKey, payload: string) {
    return this.signingRequest(
      await this.call('/v1/requests', {
        product: key.product,
        keyId: key.keyId,
        keyVersion: key.keyVersion,
        payload,
      }),
      key,
      payload
    )
  }

  async getRequest(key: ManagedSigningKey, payload: string) {
    return this.signingRequest(
      await this.call(`/v1/requests/${managedRequestId(key.product, key.keyId, payload)}`),
      key,
      payload
    )
  }
}

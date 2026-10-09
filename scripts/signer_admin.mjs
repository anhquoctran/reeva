#!/usr/bin/env node
import { request } from 'node:https'
import { createHash, createPublicKey } from 'node:crypto'
import { readFile, writeFile, chmod } from 'node:fs/promises'
import { createReadStream } from 'node:fs'

const root = process.env.SIGNER_OPERATOR_DIRECTORY || '/operator'
const signerUrl = process.env.SIGNER_URL || 'https://signer:8443'
const baoUrl = process.env.OPENBAO_URL || 'https://openbao:8200'
const caPath = process.env.SIGNER_CA_FILE || '/trust/ca.pem'
const approverPath = process.env.SIGNER_APPROVER_TOKEN_FILE || '/approver/token'
const backendTokenPath = process.env.OPENBAO_TOKEN_FILE || '/bao-client/token'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const slug = (value) =>
  typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value)

async function call(base, path, { method = 'GET', body, token, vault = false } = {}) {
  const url = new URL(path, base)
  if (url.protocol !== 'https:') throw new Error('Signing administration requires HTTPS.')
  const ca = await readFile(caPath)
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        ca,
        headers: {
          ...(token
            ? { [vault ? 'X-Vault-Token' : 'Authorization']: vault ? token : `Bearer ${token}` }
            : {}),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
        },
      },
      (res) => {
        const chunks = []
        let length = 0
        res.on('data', (chunk) => {
          length += chunk.length
          if (length > 262144) {
            res.destroy()
            reject(new Error('Administration response too large.'))
            return
          }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                `Administration request failed (HTTP ${res.statusCode}). No secrets were logged.`
              )
            )
            return
          }
          try {
            resolve(length ? JSON.parse(Buffer.concat(chunks).toString()) : {})
          } catch {
            reject(new Error('Invalid response.'))
          }
        })
      }
    )
    const timer = setTimeout(
      () => req.destroy(new Error('Administration request timed out.')),
      15000
    )
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end(bytes)
  })
}
async function credentials() {
  return JSON.parse(
    await readFile(process.env.SIGNER_RECOVERY_FILE || `${root}/initialization.json`, 'utf8')
  )
}
async function operatorToken() {
  const path = process.env.SIGNER_OPERATOR_TOKEN_FILE
  const token = path ? (await readFile(path, 'utf8')).trim() : (await credentials()).root_token
  if (!token)
    throw new Error(
      'No administrative token. Supply a separately managed SIGNER_OPERATOR_TOKEN_FILE.'
    )
  return token
}
async function retireRoot() {
  const recovery = await credentials()
  if (!recovery.root_token) throw new Error('Initial root token already removed.')
  await call(baoUrl, '/v1/auth/token/revoke-self', {
    method: 'POST',
    token: recovery.root_token,
    vault: true,
  })
  delete recovery.root_token
  await writeFile(`${root}/initialization.json`, `${JSON.stringify(recovery)}\n`, { mode: 0o600 })
  console.log(
    'Initial root token revoked and removed. Preserve recovery shares offline; future key administration requires a separately managed operator token.'
  )
}
async function unseal(keys) {
  for (const key of keys.slice(0, 2)) {
    await call(baoUrl, '/v1/sys/unseal', { method: 'POST', body: { key }, vault: true })
  }
  // Unseal returns before Raft leadership/post-unseal setup is necessarily
  // complete. Do not issue administrative writes against read-only standby.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const leader = await call(baoUrl, '/v1/sys/leader')
    if (leader.is_self) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vault unsealed but no active leader became ready within 30 seconds.')
}
async function initialize() {
  const state = await call(baoUrl, '/v1/sys/init')
  if (state.initialized)
    throw new Error(
      'Vault already initialized; use unseal/configure. Existing custody data was preserved.'
    )
  // Create the file before touching the vault. Failed init leaves a placeholder
  // that the operator must inspect/remove, never an overwritten recovery file.
  const file = `${root}/initialization.json`
  await writeFile(file, '{}\n', { flag: 'wx', mode: 0o600 })
  const result = await call(baoUrl, '/v1/sys/init', {
    method: 'PUT',
    body: { secret_shares: 3, secret_threshold: 2 },
  })
  await writeFile(file, `${JSON.stringify(result)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  await unseal(result.keys)
  await configure(result.root_token)
  console.log(
    'Vault initialized/unsealed; scoped signer token configured. Recovery material is in the operator-only volume. Export shares to independent custodians and secure/remove the retained root token before production.'
  )
}
async function configure(token) {
  const options = (body) => ({ method: 'POST', vault: true, token, body })
  const mounts = await call(baoUrl, '/v1/sys/mounts', { token, vault: true })
  if (!mounts['transit/'] && !mounts.data?.['transit/'])
    await call(baoUrl, '/v1/sys/mounts/transit', options({ type: 'transit' }))
  const policy =
    'path "transit/keys/reeva-*" { capabilities = ["read"] }\npath "transit/sign/reeva-*" { capabilities = ["update"] }\npath "auth/token/renew-self" { capabilities = ["update"] }\npath "auth/token/lookup-self" { capabilities = ["read", "update"] }'
  await call(baoUrl, '/v1/sys/policies/acl/reeva-signer', { ...options({ policy }), method: 'PUT' })
  const response = await call(
    baoUrl,
    '/v1/auth/token/create-orphan',
    options({
      policies: ['reeva-signer'],
      no_default_policy: true,
      period: '24h',
      display_name: 'reeva-signer',
    })
  )
  await writeFile(`${backendTokenPath}.tmp`, `${response.auth.client_token}\n`, { mode: 0o600 })
  const { rename } = await import('node:fs/promises')
  await rename(`${backendTokenPath}.tmp`, backendTokenPath)
}
async function provision(product) {
  if (!slug(product)) throw new Error('Provide a valid software slug.')
  const token = await operatorToken()
  await call(baoUrl, `/v1/transit/keys/reeva-${product}`, {
    method: 'POST',
    vault: true,
    token,
    body: { type: 'ed25519', derived: false, exportable: false, allow_plaintext_backup: false },
  })
  const result = await call(baoUrl, `/v1/transit/keys/reeva-${product}`, { vault: true, token })
  if (
    result.data.type !== 'ed25519' ||
    result.data.derived ||
    result.data.exportable ||
    result.data.allow_plaintext_backup
  ) {
    throw new Error('Existing key does not satisfy custody policy. No key was replaced.')
  }
  const version = result.data.latest_version
  const raw = Buffer.from(result.data.keys[version].public_key, 'base64')
  if (raw.length !== 32) throw new Error('Invalid provider public key.')
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  })
  console.log(
    `product=${product}\nkeyVersion=${version}\nkeyId=${hash(publicKey.export({ type: 'spki', format: 'der' }))}\n${publicKey.export({ type: 'spki', format: 'pem' })}`
  )
}
async function signingRequest(id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Provide a signing request ID.')
  const token = (await readFile(approverPath, 'utf8')).trim()
  return { token, value: await call(signerUrl, `/v1/requests/${id}`, { token }) }
}
async function approve(id, path, expectedDigest) {
  if (!path || !/^[a-f0-9]{64}$/.test(expectedDigest || ''))
    throw new Error(
      'approve requires <request-id> <artifact-file> <reviewed-payload-digest>. Run review first.'
    )
  const { token, value } = await signingRequest(id)
  const bytes = Buffer.from(value.payload, 'base64url')
  if (hash(bytes) !== expectedDigest || value.payloadDigest !== expectedDigest)
    throw new Error('Manifest changed or review digest mismatched.')
  const manifest = JSON.parse(bytes)
  const checksum = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    size += chunk.length
    checksum.update(chunk)
  }
  const sha256 = checksum.digest('hex')
  if (sha256 !== manifest.sha256 || size !== manifest.sizeBytes)
    throw new Error('Local independently obtained artifact does not match manifest.')
  const result = await call(signerUrl, `/v1/requests/${id}/approve`, {
    method: 'POST',
    token,
    body: {
      payloadDigest: expectedDigest,
      artifactSha256: sha256,
      artifactSizeBytes: size,
      expiresAt: value.expiresAt,
    },
  })
  console.log(
    `request=${result.id}\nstatus=${result.status}\nkeyId=${result.keyId}\nsignature=${result.signature}`
  )
}

try {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'init' && args.length === 0) await initialize()
  else if (command === 'unseal' && args.length === 0) {
    await unseal((await credentials()).keys)
    console.log('Vault unsealed.')
  } else if (command === 'configure' && args.length === 0) {
    await configure(await operatorToken())
    console.log('Scoped runtime token replaced; previous token must be revoked by an operator.')
  } else if (command === 'retire-root' && args.length === 0) await retireRoot()
  else if (command === 'provision' && args.length === 1) await provision(args[0])
  else if (command === 'review' && args.length === 1) {
    const { value } = await signingRequest(args[0])
    const bytes = Buffer.from(value.payload, 'base64url')
    console.log(
      JSON.stringify(
        {
          id: value.id,
          keyId: value.keyId,
          keyVersion: value.keyVersion,
          payloadDigest: hash(bytes),
          manifest: JSON.parse(bytes),
          status: value.status,
          expiresAt: value.expiresAt,
        },
        null,
        2
      )
    )
  } else if (command === 'approve' && args.length === 3) await approve(...args)
  else
    throw new Error(
      'Commands: init | unseal | configure | retire-root | provision <software-slug> | review <request-id> | approve <request-id> <artifact-file> <reviewed-payload-digest>'
    )
} catch (error) {
  // HTTPS errors can contain no response secrets; do not emit response bodies,
  // credential objects, stacks, or provider request headers.
  console.error(error instanceof Error ? error.message : 'Signing administration failed.')
  process.exitCode = 1
}

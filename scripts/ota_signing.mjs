#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function usage() {
  process.stderr.write(`Usage:
  node scripts/ota_signing.mjs generate <key-directory>
  node scripts/ota_signing.mjs fingerprint --public-key <public-key.pem>
  node scripts/ota_signing.mjs sign --payload-base64url <payload> --private-key <private-key.pem>

The private key is generated locally and is never sent to Reeva.
`)
}

function parseOptions(args) {
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || !value || options.has(name)) {
      throw new Error(`Invalid or duplicate option: ${name || '(missing)'}`)
    }
    options.set(name, value)
  }
  return options
}

function keyId(publicKey) {
  const key = createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('OTA release signing keys must use Ed25519.')
  }
  const der = key.export({ format: 'der', type: 'spki' })
  return createHash('sha256').update(der).digest('hex')
}

function generate(directoryInput) {
  if (!directoryInput) throw new Error('Provide a directory for the key pair.')
  const directory = resolve(directoryInput)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const privatePath = join(directory, 'reeva-ota-private.pem')
  const publicPath = join(directory, 'reeva-ota-public.pem')
  if (existsSync(privatePath) || existsSync(publicPath)) {
    throw new Error('Key output files already exist; choose an empty directory.')
  }

  const pair = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })

  let privateCreated = false
  try {
    writeFileSync(privatePath, pair.privateKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    privateCreated = true
    writeFileSync(publicPath, pair.publicKey, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  } catch (error) {
    if (privateCreated) unlinkSync(privatePath)
    throw error
  }

  process.stdout.write(`keyId=${keyId(pair.publicKey)}\npublicKey=${publicPath}\nprivateKey=${privatePath}\n`)
}

function fingerprint(options) {
  const publicPath = options.get('--public-key')
  if (!publicPath || options.size !== 1) throw new Error('Provide --public-key <public-key.pem>.')
  process.stdout.write(`${keyId(readFileSync(publicPath, 'utf8').trim())}\n`)
}

function signPayload(options) {
  const privatePath = options.get('--private-key')
  const payloadText = options.get('--payload-base64url')
  if (!privatePath || !payloadText || options.size !== 2) {
    throw new Error('Provide --payload-base64url and --private-key.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(payloadText) || payloadText.length > 120_000) {
    throw new Error('The payload must be a base64url string representing at most 90 KB.')
  }

  const privateKey = createPrivateKey(readFileSync(privatePath, 'utf8'))
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('OTA release signing keys must use Ed25519.')
  }

  const permissions = statSync(privatePath).mode & 0o777
  if (permissions & 0o077) {
    process.stderr.write('Warning: private key file permissions allow group/other access. Restrict them to owner-only.\n')
  }

  const payload = Buffer.from(payloadText, 'base64url')
  if (payload.length === 0 || payload.toString('base64url') !== payloadText) {
    throw new Error('The payload is not valid canonical base64url.')
  }

  process.stdout.write(`${sign(null, payload, privateKey).toString('base64url')}\n`)
}

try {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'generate') {
    generate(args[0])
  } else if (command === 'fingerprint') {
    fingerprint(parseOptions(args))
  } else if (command === 'sign') {
    signPayload(parseOptions(args))
  } else {
    usage()
    process.exitCode = command ? 2 : 0
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'OTA signing failed.'}\n`)
  process.exitCode = 1
}

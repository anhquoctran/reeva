import assert from 'node:assert/strict'
import { createHash, verify } from 'node:crypto'

// Used only by the disposable Compose verifier. No application .env, production
// key, existing volume, or exposed custody port is needed.
export async function verifySignerStack(compose, { verifyReevaConsumer = true } = {}) {
  const admin = (...args) => compose(['run', '--rm', '-T', 'signer-admin', ...args])
  const operator = (...args) => compose(['run', '--rm', '-T', 'signer-operator', ...args])
  const app = (code) => compose(['exec', '-T', 'app', 'node', '--input-type=module', '-e', code])
  const requester = (path, body, tokenOverride) =>
    JSON.parse(
      app(`
    import {request} from 'node:https';import {readFile} from 'node:fs/promises';
    const ca=await readFile('/app/signer-trust/ca.pem');
    const token=${tokenOverride === undefined ? "(await readFile('/app/signer-requester/token','utf8')).trim()" : JSON.stringify(tokenOverride)};
    const body=${JSON.stringify(body ?? null)};const bytes=body===null?undefined:Buffer.from(JSON.stringify(body));
    const result=await new Promise((resolve,reject)=>{const req=request(new URL(${JSON.stringify(path)},'https://signer:8443'),
    {method:bytes?'POST':'GET',ca,headers:{Authorization:'Bearer '+token,...(bytes?{'Content-Type':'application/json'}:{})}},res=>{
    let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));res.on('error',reject)});
    req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('test deadline')));req.end(bytes)});console.log(JSON.stringify(result));
  `)
    )
  const approver = (path, body, concurrency = 1) =>
    JSON.parse(
      compose([
        'run',
        '--rm',
        '-T',
        '--entrypoint',
        'node',
        'signer-admin',
        '--input-type=module',
        '-e',
        `
    import {request} from 'node:https';import {readFile} from 'node:fs/promises';
    const ca=await readFile('/trust/ca.pem');const token=(await readFile('/approver/token','utf8')).trim();
    const bytes=Buffer.from(JSON.stringify(${JSON.stringify(body)}));
    const call=()=>new Promise((resolve,reject)=>{const req=request(new URL(${JSON.stringify(path)},'https://signer:8443'),
    {method:'POST',ca,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
    let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));res.on('error',reject)});
    req.on('error',reject);req.setTimeout(20000,()=>req.destroy(new Error('test deadline')));req.end(bytes)});
    const results=await Promise.all(Array.from({length:${concurrency}},call));console.log(JSON.stringify(${concurrency === 1 ? 'results[0]' : 'results'}));
  `,
      ])
    )
  const sql = (query) =>
    compose([
      'exec',
      '-T',
      'signer-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'signer',
      '-tAc',
      query,
    ])
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    schemaVersion: 1,
    software: 'compose-test',
    version: '1.2.3',
    codename: null,
    changelog: 'Synthetic integration release',
    channel: 'stable',
    platform: 'linux',
    architecture: 'x64',
    fileName: 'synthetic.bin',
    sizeBytes: 3,
    sha256: digest('abc'),
  }
  const payload = Buffer.from(JSON.stringify(manifest)).toString('base64url')
  const payloadDigest = digest(Buffer.from(payload, 'base64url'))

  assert.equal(requester('/ready').status, 503, 'Fresh custody must start sealed/uninitialized.')
  assert.equal(requester('/v1/products/compose-test/key', null, 'wrong-token').status, 401)
  operator('init')
  operator('provision', manifest.software)
  assert.equal(requester('/ready').status, 200)
  const key = requester('/v1/products/compose-test/key').body
  const input = {
    product: manifest.software,
    payload,
    keyId: key.keyId,
    keyVersion: key.keyVersion,
  }
  const created = requester('/v1/requests', input)
  assert.equal(created.status, 200)
  assert.equal(created.body.status, 'pending')
  const id = created.body.id
  assert.equal(
    requester('/v1/requests', input).body.id,
    id,
    'Duplicate submission must be idempotent.'
  )
  assert.equal(
    requester(`/v1/requests/${id}/approve`, {
      payloadDigest,
      artifactSha256: manifest.sha256,
      artifactSizeBytes: 3,
      expiresAt: created.body.expiresAt,
    }).status,
    401,
    'Reeva requester must not approve.'
  )
  assert.equal(requester('/v1/requests', { ...input, product: 'different-product' }).status, 400)
  compose([
    'run',
    '--rm',
    '-T',
    '--entrypoint',
    'node',
    'signer-admin',
    '-e',
    "require('node:fs').writeFileSync('/artifacts/synthetic.bin','abc',{mode:0o600});require('node:fs').writeFileSync('/artifacts/wrong.bin','xyz',{mode:0o600})",
  ])
  const wrong = admin('review', id)
  assert.ok(wrong.includes(payloadDigest))
  const rejected = compose(
    ['run', '--rm', '-T', 'signer-admin', 'approve', id, '/artifacts/wrong.bin', payloadDigest],
    { check: false }
  )
  assert.ok(!rejected.includes('status=signed'))
  assert.equal(requester(`/v1/requests/${id}`).body.status, 'pending')
  admin('approve', id, '/artifacts/synthetic.bin', payloadDigest)
  const signed = requester(`/v1/requests/${id}`).body
  assert.equal(signed.status, 'signed')
  assert.equal(signed.payload, payload)
  assert.equal(
    verify(
      null,
      Buffer.from(payload, 'base64url'),
      key.publicKey,
      Buffer.from(signed.signature, 'base64url')
    ),
    true
  )
  assert.equal(
    verify(
      null,
      Buffer.from('tampered'),
      key.publicKey,
      Buffer.from(signed.signature, 'base64url')
    ),
    false
  )
  admin('approve', id, '/artifacts/synthetic.bin', payloadDigest)
  assert.equal(requester(`/v1/requests/${id}`).body.signature, signed.signature)

  const concurrentPayload = Buffer.from(JSON.stringify({ ...manifest, version: '1.2.5' })).toString(
    'base64url'
  )
  const concurrent = requester('/v1/requests', { ...input, payload: concurrentPayload }).body
  const concurrentResults = approver(
    `/v1/requests/${concurrent.id}/approve`,
    {
      payloadDigest: concurrent.payloadDigest,
      artifactSha256: manifest.sha256,
      artifactSizeBytes: 3,
      expiresAt: concurrent.expiresAt,
    },
    8
  )
  assert.ok(concurrentResults.every((result) => result.status === 200))
  assert.equal(new Set(concurrentResults.map((result) => result.body.signature)).size, 1)
  assert.equal(
    sql(
      `SELECT count(*) FROM signing_audit WHERE request_id='${concurrent.id}' AND event='approved-and-signed'`
    ),
    '1'
  )
  // Confirm the actual TypeScript consumer accepts the provider envelope.
  const consumed = verifyReevaConsumer
    ? JSON.parse(
        app(`
    import {readFile} from 'node:fs/promises';process.env.APP_KEY=(await readFile('/app/storage/.app_key','utf8')).trim();
    const {default:Signer}=await import('/app/build/app/services/managed_signer_service.js');
    const client=new Signer();const key=await client.getKey('compose-test');
    const request=await client.getRequest(key,${JSON.stringify(payload)});console.log(JSON.stringify({status:request.status,signature:request.signature}));
  `)
      )
    : null
  if (consumed) assert.equal(consumed.signature, signed.signature)
  const audit = compose([
    'exec',
    '-T',
    'signer-postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'signer',
    '-tAc',
    `SELECT count(*) FROM signing_audit WHERE request_id='${id}' AND event='approved-and-signed'`,
  ])
  assert.equal(audit, '1')

  const custodyDenied = compose([
    'exec',
    '-T',
    'signer',
    'sh',
    '-c',
    'printf \'header = "X-Vault-Token: %s"\\n\' "$(cat /bao-client/token)" | curl --silent --cacert /trust/ca.pem --config - --output /dev/null --write-out "%{http_code}" https://openbao:8200/v1/transit/export/signing-key/reeva-compose-test',
  ])
  assert.equal(custodyDenied, '403', 'Runtime custody identity must not export keys.')
  const isolated = compose([
    'run',
    '--rm',
    '-T',
    '--entrypoint',
    'node',
    'signer-admin',
    '-e',
    "const fs=require('node:fs');console.log(fs.existsSync('/operator/initialization.json')||fs.existsSync('/bao-client/token'))",
  ])
  assert.equal(isolated, 'false', 'Approver must not receive vault operator/runtime credentials.')

  const pendingPayload = Buffer.from(JSON.stringify({ ...manifest, version: '1.2.4' })).toString(
    'base64url'
  )
  const pending = requester('/v1/requests', { ...input, payload: pendingPayload }).body
  const approval = {
    payloadDigest: pending.payloadDigest,
    artifactSha256: manifest.sha256,
    artifactSizeBytes: 3,
    expiresAt: pending.expiresAt,
  }
  sql(`UPDATE signing_requests SET expires_at=1 WHERE id='${pending.id}'`)
  assert.equal(
    approver(`/v1/requests/${pending.id}/approve`, { ...approval, expiresAt: 1 }).status,
    410
  )
  const renewed = requester('/v1/requests', { ...input, payload: pendingPayload }).body
  assert.ok(renewed.expiresAt > 1)
  assert.equal(
    approver(`/v1/requests/${pending.id}/approve`, { ...approval, expiresAt: 1 }).status,
    409
  )
  const renewedApproval = { ...approval, expiresAt: renewed.expiresAt }
  // Inject a DB failure after the real provider has signed. No signature may be
  // returned before the audit/result transaction commits.
  sql(
    `CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='approved-and-signed' AND NEW.request_id='${pending.id}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_audit BEFORE INSERT ON signing_audit FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`
  )
  const failed = approver(`/v1/requests/${pending.id}/approve`, renewedApproval)
  assert.equal(failed.status, 503)
  assert.equal(failed.body.signature, undefined)
  assert.equal(requester(`/v1/requests/${pending.id}`).body.signature, null)
  sql('DROP TRIGGER test_fail_audit ON signing_audit; DROP FUNCTION test_fail_audit()')
  assert.equal(approver(`/v1/requests/${pending.id}/approve`, renewedApproval).status, 200)
  assert.equal(
    sql(
      `SELECT count(*) FROM signing_audit WHERE request_id='${pending.id}' AND event='approved-and-signed'`
    ),
    '1'
  )
  operator('retire-root')
  assert.equal(
    requester('/ready').status,
    200,
    'Orphan runtime token must survive retiring the bootstrap root token.'
  )

  // A second API replica shares durable state. Existing signatures survive loss
  // of either replica; this is HA functionality, not threshold cryptography.
  compose(['up', '-d', '--no-build', '--scale', 'signer=2', 'signer'])
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (requester(`/v1/requests/${id}`).body.signature === signed.signature) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.equal(requester(`/v1/requests/${id}`).body.signature, signed.signature)

  compose(['restart', 'openbao'])
  for (let attempt = 0; attempt < 20; attempt++) {
    if (requester('/ready').status === 503) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.equal(requester('/ready').status, 503, 'Restart must not silently auto-unseal.')
  assert.equal(
    requester('/v1/requests', {
      ...input,
      payload: Buffer.from(JSON.stringify({ ...manifest, version: '1.2.4' })).toString('base64url'),
    }).status,
    503
  )
  assert.equal(
    requester(`/v1/requests/${id}`).body.signature,
    signed.signature,
    'Previously signed results remain durable while sealed.'
  )
  operator('unseal')
  assert.equal(requester('/ready').status, 200)
  assert.equal(requester('/v1/products/compose-test/key').body.keyId, key.keyId)
  console.log(
    'Signer integration passed: TLS, independent roles, denied key export, OpenBao Ed25519, Node verification, idempotency, expiry/renewal, DB failure after signing, atomic audit, retired root token, replicas, eight concurrent approvals, seal/restart recovery and persistent key identity.'
  )
}

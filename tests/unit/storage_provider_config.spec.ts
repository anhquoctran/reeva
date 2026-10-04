import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import StorageProvider from '#models/storage_provider'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import StorageProviderService from '#services/storage_provider_service'
import StorageManager from '#services/storage/storage_manager'
import S3CompatibleProvider from '#services/storage/providers/s3_compatible_provider'

const secretKey = 'synthetic-secret-storage-key-123456789'
const accessKey = 'synthetic-access-storage-key'

function service() {
  return new StorageProviderService(new StorageProviderRepository())
}

function s3Input(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Runtime R2',
    driver: 'r2',
    quotaGb: '10',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'reeva-release-test',
    forcePathStyle: 'false',
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    sessionToken: 'synthetic-session-token',
    maxAttempts: '2',
    connectionTimeoutMs: '5000',
    socketTimeoutMs: '90000',
    downloadUrlTtlSeconds: '1800',
    ...overrides,
  }
}

test.group('database managed storage provider settings', (group) => {
  let truncateDatabase: (() => Promise<void>) | undefined

  group.setup(async () => {
    truncateDatabase = await testUtils.db().truncate()
  })

  group.teardown(async () => {
    await truncateDatabase?.()
  })

  test('encrypts provider config at rest and excludes secrets from serialization and the edit view', async ({
    assert,
  }) => {
    const created = await service().createProvider(s3Input())
    const stored = await db.from('storage_providers').where('id', created.id).firstOrFail()
    const serialized = created.serialize()
    const editView = service().getProviderEditView(created)

    assert.equal(stored.config.__reevaStorageProviderConfig, 1)
    assert.notInclude(JSON.stringify(stored.config), secretKey)
    assert.notInclude(JSON.stringify(stored.config), accessKey)
    assert.notProperty(serialized, 'config')
    assert.notInclude(JSON.stringify(editView), secretKey)
    assert.notInclude(JSON.stringify(editView), accessKey)
    assert.isTrue(editView.config.credentialsConfigured)
    assert.isTrue(editView.config.sessionTokenConfigured)
  })

  test('keeps omitted secrets, rotates the key pair together, and supports explicit clearing', async ({
    assert,
  }) => {
    const storage = service()
    const created = await storage.createProvider(s3Input())

    await storage.updateProvider(
      created.id,
      s3Input({
        name: 'Runtime R2 Updated',
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: '',
      })
    )
    let current = await StorageProvider.findOrFail(created.id)
    assert.equal(current.config.accessKeyId, accessKey)
    assert.equal(current.config.secretAccessKey, secretKey)
    assert.equal(current.config.sessionToken, 'synthetic-session-token')

    await assert.rejects(
      () =>
        storage.updateProvider(
          created.id,
          s3Input({ accessKeyId: 'replacement-access', secretAccessKey: '' })
        ),
      /Enter both access key ID and secret access key/
    )

    await storage.updateProvider(
      created.id,
      s3Input({ accessKeyId: 'replacement-access', secretAccessKey: 'replacement-secret' })
    )
    current = await StorageProvider.findOrFail(created.id)
    assert.equal(current.config.accessKeyId, 'replacement-access')
    assert.equal(current.config.secretAccessKey, 'replacement-secret')

    await storage.updateProvider(
      created.id,
      s3Input({ accessKeyId: '', secretAccessKey: '', clearCredentials: 'true' })
    )
    current = await StorageProvider.findOrFail(created.id)
    assert.isUndefined(current.config.accessKeyId)
    assert.isUndefined(current.config.secretAccessKey)
    assert.isUndefined(current.config.sessionToken)
  })

  test('switches the default in PostgreSQL immediately and leaves the old provider active', async ({
    assert,
  }) => {
    const storage = service()
    const local = await storage.createProvider({
      name: 'Persistent Local',
      driver: 'local',
      quotaGb: '10',
      root: '/tmp/reeva-runtime-storage',
    })
    await storage.activateProvider(local.id)

    const remote = await storage.createProvider(s3Input())
    await storage.activateProvider(remote.id)

    const independentlyResolvedService = service()
    const selected = await independentlyResolvedService.getDefaultProvider()
    const previous = await StorageProvider.findOrFail(local.id)
    assert.equal(selected?.id, remote.id)
    assert.isTrue(selected?.isActive)
    assert.isTrue(previous.isActive)
    assert.isFalse(previous.isDefault)
    assert.instanceOf(StorageManager.resolve(selected!), S3CompatibleProvider)
  })

  test('rejects corrupted authenticated encryption instead of returning damaged settings', async ({
    assert,
  }) => {
    const provider = await service().createProvider(s3Input())
    const raw = await db.from('storage_providers').where('id', provider.id).firstOrFail()
    await db
      .from('storage_providers')
      .where('id', provider.id)
      .update({
        config: {
          ...raw.config,
          payload: `${raw.config.payload}tampered`,
        },
      })

    await assert.rejects(
      () => StorageProvider.findOrFail(provider.id),
      /Cannot decrypt storage provider config/
    )
  })
})

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import type { HttpContext } from '@adonisjs/core/http'
import Artifact from '#models/artifact'
import Architecture from '#models/architecture'
import Platform from '#models/platform'
import StorageProvider from '#models/storage_provider'
import Software from '#models/software'
import User from '#models/user'
import License from '#models/license'
import LicenseActivation from '#models/license_activation'
import Setting from '#models/setting'
import Version from '#models/version'
import ArtifactRepository from '#repositories/artifact_repository'
import ArchitectureRepository from '#repositories/architecture_repository'
import DownloadHistoryRepository from '#repositories/download_history_repository'
import PlatformRepository from '#repositories/platform_repository'
import SoftwareRepository from '#repositories/software_repository'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import UserRepository from '#repositories/user_repository'
import LicenseRepository from '#repositories/license_repository'
import VersionRepository from '#repositories/version_repository'
import ArtifactService, { artifactDetailsDto } from '#services/artifact_service'
import DashboardService from '#services/dashboard_service'
import AuthService from '#services/auth_service'
import LicenseService from '#services/license_service'
import { attachmentDisposition } from '#services/download_headers'
import UpdaterService, { ArtifactStorageError } from '#services/updater_service'
import VersionService from '#services/version_service'
import SoftwareService from '#services/software_service'
import StorageProviderService from '#services/storage_provider_service'
import LocalProvider from '#services/storage/providers/local_provider'
import UpdaterController from '#controllers/api/updater_controller'
import SessionController from '#controllers/session_controller'
import RootMiddleware from '#middleware/root_middleware'
import RealIpMiddleware from '#middleware/real_ip_middleware'
import SoftwareSigningKey from '#models/software_signing_key'
import {
  createOtaReleasePayload,
  createOtaSignatureEnvelope,
  verifyOtaReleaseSignature,
} from '#services/ota_release_signature_service'
import ManagedSignerService, { managedRequestId } from '#services/managed_signer_service'
import router from '@adonisjs/core/services/router'

type Fixture = {
  version: Version
  platform: Platform
  architecture: Architecture
  storageProvider: StorageProvider
  root: string
}

const tempRoots: string[] = []
let versionSequence = 0

async function defaultSoftware() {
  const current = await Software.query().where('isDefault', true).first()
  if (current) return current
  return Software.create({
    name: 'Reeva',
    slug: 'reeva',
    isActive: true,
    isDefault: true,
  })
}

function makeUpdaterService(repository = new ArtifactRepository()) {
  return new UpdaterService(repository, new SoftwareRepository())
}

function assertUuid(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('Expected model creation to preserve a generated UUID primary key.')
  }
}

async function makeFixture(
  options: { activeVersion?: boolean; quotaBytes?: number } = {}
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'reeva-audit-'))
  tempRoots.push(root)
  const suffix = randomUUID()
  const software = await defaultSoftware()
  versionSequence++
  const version = await Version.create({
    softwareId: software.id,
    major: 1,
    minor: versionSequence,
    patch: 0,
    codename: 'Audit Test',
    changelog: null,
    isActive: options.activeVersion ?? true,
    releaseDate: null,
  })
  const platform = await Platform.create({
    name: `linux-${suffix}`,
    displayName: 'Linux',
  })
  const architecture = await Architecture.create({
    name: `x64-${suffix}`,
    displayName: 'x64',
  })
  const storageProvider = await StorageProvider.create({
    name: `Local ${suffix}`,
    type: 'local',
    config: { driver: 'local', root },
    isActive: true,
    isDefault: false,
    quotaBytes: options.quotaBytes ?? 10_000_000,
  })

  assertUuid(version.id)
  assertUuid(platform.id)
  assertUuid(architecture.id)
  assertUuid(storageProvider.id)

  return { version, platform, architecture, storageProvider, root }
}

async function makeArtifact(fixture: Fixture, overrides: Partial<Artifact> = {}) {
  return Artifact.create({
    versionId: fixture.version.id,
    platformId: fixture.platform.id,
    architectureId: fixture.architecture.id,
    storageProviderId: fixture.storageProvider.id,
    fileName: 'reeva_test_v1.zip',
    mimeType: 'application/octet-stream',
    sizeBytes: 4,
    checksum: null,
    checksumMd5: null,
    checksumSha1: null,
    checksumSha256: null,
    checksumSha512: null,
    storageKey: `releases/${randomUUID()}.zip`,
    isArchived: false,
    isPublished: true,
    publishedAt: DateTime.utc(),
    channel: 'stable',
    ...overrides,
  })
}

function makeArtifactService() {
  return new ArtifactService(
    new ArtifactRepository(),
    new VersionRepository(),
    new PlatformRepository(),
    new ArchitectureRepository(),
    new StorageProviderRepository()
  )
}

function multipartFile(path: string, size: number) {
  return {
    tmpPath: path,
    size,
    clientName: 'release.zip',
    extname: 'zip',
    headers: { 'content-type': 'application/zip' },
  } as unknown as MultipartFile
}

test.group('security and release regressions', (group) => {
  let truncateDatabase: (() => Promise<void>) | undefined

  group.setup(async () => {
    truncateDatabase = await testUtils.db().truncate()
  })

  group.teardown(async () => {
    await truncateDatabase?.()
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
    tempRoots.length = 0
  })

  test('signed-only publication verifies exact metadata and public reads exclude revoked keys', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const product = await new SoftwareService(new SoftwareRepository()).create({
      name: `Signed ${randomUUID()}`,
    })
    fixture.version.softwareId = product.id
    await fixture.version.save()
    const pair = generateKeyPairSync('ed25519')
    const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const key = await new SoftwareService(new SoftwareRepository()).addSigningKey(
      product.id,
      publicPem
    )
    product.requireSignedUpdates = true
    await product.save()
    const artifact = await makeArtifact(fixture, {
      isPublished: false,
      checksumSha256: createHash('sha256').update('test').digest('hex'),
    })
    const service = makeArtifactService()
    await assert.rejects(() => service.publishArtifact(artifact.id), /valid release signature/)
    const data = await service.getEditData(artifact.id)
    const payload = data.signingPayload!
    const signature = sign(null, Buffer.from(payload, 'base64url'), pair.privateKey).toString(
      'base64url'
    )
    assert.isTrue(verifyOtaReleaseSignature(payload, signature, publicPem))
    assert.isFalse(verifyOtaReleaseSignature(payload + '=', signature, publicPem))
    await service.setArtifactSignature(artifact.id, key.keyId, signature)
    await service.publishArtifact(artifact.id)
    const publishedData = await service.getEditData(artifact.id)
    assert.isNotNull(createOtaSignatureEnvelope(publishedData.artifact))
    assert.isNotNull(await new ArtifactRepository().findPublicById(artifact.id))
    assert.notInclude(JSON.stringify(key.serialize()), 'PRIVATE KEY')
    // Model an edit committed just before a stale verified signature save.
    // The saved signature snapshot cannot match the new version metadata.
    const previousCodename = fixture.version.codename
    fixture.version.codename = 'Changed after verification'
    await fixture.version.save()
    assert.isNull(await new ArtifactRepository().findPublicById(artifact.id))
    const changedData = await service.getEditData(artifact.id)
    assert.isNull(createOtaSignatureEnvelope(changedData.artifact))
    assert.isNull(await new ArtifactRepository().findPublicByStorageKey(artifact.storageKey))
    const changedReleases = await makeUpdaterService().getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      10,
      1,
      product.slug
    )
    assert.equal(changedReleases.pagination.total, 0)
    fixture.version.codename = previousCodename
    await fixture.version.save()
    assert.isNotNull(await new ArtifactRepository().findPublicById(artifact.id))
    const currentKey = await SoftwareSigningKey.findOrFail(key.id)
    currentKey.isActive = false
    await currentKey.save()
    assert.isNull(await new ArtifactRepository().findPublicById(artifact.id))
    assert.isNull(await new ArtifactRepository().findPublicByStorageKey(artifact.storageKey))
    const releases = await makeUpdaterService().getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      10,
      1,
      product.slug
    )
    assert.equal(releases.pagination.total, 0)
  })

  test('a signature for stale metadata or another product is rejected', async ({ assert }) => {
    const fixture = await makeFixture()
    const pair = generateKeyPairSync('ed25519')
    const software = await defaultSoftware()
    const key = await new SoftwareService(new SoftwareRepository()).addSigningKey(
      software.id,
      pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    )
    const artifact = await makeArtifact(fixture, {
      isPublished: false,
      checksumSha256: createHash('sha256').update('test').digest('hex'),
    })
    const service = makeArtifactService()
    const loaded = await service.getEditData(artifact.id)
    const signature = sign(
      null,
      Buffer.from(createOtaReleasePayload(loaded.artifact), 'base64url'),
      pair.privateKey
    ).toString('base64url')
    artifact.channel = 'beta'
    await artifact.save()
    await assert.rejects(
      () => service.setArtifactSignature(artifact.id, key.keyId, signature),
      /verification failed/
    )
    const foreign = await new SoftwareService(new SoftwareRepository()).create({
      name: `Foreign ${randomUUID()}`,
    })
    const otherPair = generateKeyPairSync('ed25519')
    const foreignKey = await new SoftwareService(new SoftwareRepository()).addSigningKey(
      foreign.id,
      otherPair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    )
    await assert.rejects(
      () => service.setArtifactSignature(artifact.id, foreignKey.keyId, signature),
      /not active for this software/
    )
  })

  test('managed signer consumer rejects key substitution and tampered signatures', async ({
    assert,
  }) => {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const keyId = createHash('sha256')
      .update(pair.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex')
    const client = new ManagedSignerService()
    const mutable = client as unknown as { call: () => Promise<Record<string, unknown>> }
    mutable.call = async () => ({
      product: 'signed-client',
      publicKey,
      keyId: 'a'.repeat(64),
      keyVersion: 1,
    })
    await assert.rejects(() => client.getKey('signed-client'), /fingerprint mismatch/)
    const key = { product: 'signed-client', publicKey, keyId, keyVersion: 1 }
    const payload = Buffer.from('{"software":"signed-client"}').toString('base64url')
    const response = {
      ...key,
      id: managedRequestId(key.product, keyId, payload),
      payload,
      payloadDigest: createHash('sha256').update(Buffer.from(payload, 'base64url')).digest('hex'),
      status: 'signed',
      signature: sign(null, Buffer.from(payload, 'base64url'), pair.privateKey).toString(
        'base64url'
      ),
      expiresAt: 1900000000,
    }
    mutable.call = async () => response
    const accepted = await client.getRequest(key, payload)
    assert.equal(accepted?.signature, response.signature)
    mutable.call = async () => ({ ...response, signature: 'a'.repeat(86) })
    await assert.rejects(() => client.getRequest(key, payload), /invalid release signature/)
    mutable.call = async () => ({
      ...response,
      payload: Buffer.from('changed').toString('base64url'),
    })
    await assert.rejects(() => client.getRequest(key, payload), /does not match this release/)
  })

  test('public eligibility excludes drafts, archived releases, inactive versions, and deleted joins', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const repository = new ArtifactRepository()
    const published = await makeArtifact(fixture)
    const draft = await makeArtifact(fixture, { channel: 'beta', isPublished: false })
    const archived = await makeArtifact(fixture, { channel: 'dev', isArchived: true })

    assert.isNotNull(await repository.findPublicById(published.id))
    assert.isNull(await repository.findPublicById(draft.id))
    assert.isNull(await repository.findPublicById(archived.id))

    const inactiveFixture = await makeFixture({ activeVersion: false })
    const inactive = await makeArtifact(inactiveFixture)
    assert.isNull(await repository.findPublicById(inactive.id))

    const deletedFixture = await makeFixture()
    const deletedJoin = await makeArtifact(deletedFixture)
    await deletedFixture.platform.delete()
    assert.isNull(await repository.findPublicById(deletedJoin.id))

    const inactiveProviderFixture = await makeFixture()
    const inactiveProviderArtifact = await makeArtifact(inactiveProviderFixture)
    inactiveProviderFixture.storageProvider.isActive = false
    await inactiveProviderFixture.storageProvider.save()
    assert.isNull(await repository.findPublicById(inactiveProviderArtifact.id))

    const update = await makeUpdaterService(repository).checkForUpdate(
      fixture.platform.name,
      fixture.architecture.name,
      '0.9.0',
      'stable'
    )
    assert.equal(update?.id, published.id)
    const releases = await makeUpdaterService(repository).getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      10,
      1
    )
    assert.equal(releases.pagination.total, 1)
    assert.equal(releases.results[0]?.id, published.id)
  })

  test('PostgreSQL release pagination counts eligible rows separately from selected artifact columns', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const original = await makeArtifact(fixture)
    const newerVersion = await Version.create({
      softwareId: fixture.version.softwareId,
      major: 1,
      minor: fixture.version.minor + 10000,
      patch: 0,
      isActive: true,
    })
    const newer = await makeArtifact(fixture, { versionId: newerVersion.id })
    const excludedVersion = await Version.create({
      softwareId: fixture.version.softwareId,
      major: 1,
      minor: fixture.version.minor + 10001,
      patch: 0,
      isActive: true,
    })
    await makeArtifact(fixture, { versionId: excludedVersion.id, isArchived: true })
    const service = makeUpdaterService()
    const first = await service.getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      1,
      1
    )
    const second = await service.getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      1,
      2
    )
    const empty = await service.getReleases(
      fixture.platform.name,
      fixture.architecture.name,
      'stable',
      1,
      3
    )
    assert.equal(first.pagination.total, 2)
    assert.equal(first.pagination.totalPages, 2)
    assert.equal(first.results[0].id, newer.id)
    assert.equal(second.results[0].id, original.id)
    assert.equal(empty.pagination.total, 2)
    assert.lengthOf(empty.results, 0)
    assert.isNumber(first.results[0].sizeBytes)
    assert.isNumber(fixture.storageProvider.quotaBytes)
  })

  test('software slugs are safely generated, unique under concurrent creation, and stable after rename', async ({
    assert,
  }) => {
    const service = new SoftwareService(new SoftwareRepository())
    const first = await service.create({
      name: '  Crème Brûlée / Desktop!  ',
      slug: 'unsafe/client-supplied-slug',
    })
    assert.equal(first.slug, 'creme-brulee-desktop')

    const [second, third] = await Promise.all([
      service.create({ name: 'Crème Brûlée / Desktop!' }),
      service.create({ name: 'Crème Brûlée / Desktop!' }),
    ])
    assert.sameMembers(
      [second.slug, third.slug],
      ['creme-brulee-desktop-2', 'creme-brulee-desktop-3']
    )

    const fallback = await service.create({ name: '✨' })
    assert.equal(fallback.slug, 'software')
    assert.match(first.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.isAtMost(first.slug.length, 80)

    const renamed = await service.updateName(first.id, 'Renamed Desktop App')
    assert.equal(renamed.slug, 'creme-brulee-desktop')
  })

  test('semantic versions, OTA selection, and legacy routing are isolated per software', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const legacySoftware = await defaultSoftware()
    const secondSoftware = await Software.create({
      name: 'Orbit Mobile',
      slug: 'orbit-mobile',
      isActive: true,
      isDefault: false,
    })
    const service = new VersionService(
      new VersionRepository(),
      new ArtifactRepository(),
      new SoftwareRepository()
    )
    const secondVersion = await service.createVersion({
      softwareId: secondSoftware.id,
      major: String(fixture.version.major),
      minor: String(fixture.version.minor),
      patch: String(fixture.version.patch),
      isActive: 'on',
    })

    assert.equal(secondVersion.softwareId, secondSoftware.id)
    await assert.rejects(() =>
      service.createVersion({
        softwareId: secondSoftware.id,
        major: String(fixture.version.major),
        minor: String(fixture.version.minor),
        patch: String(fixture.version.patch),
      })
    )

    const legacyArtifact = await makeArtifact(fixture)
    const secondArtifact = await makeArtifact(fixture, { versionId: secondVersion.id })
    const updater = makeUpdaterService()
    const legacyUpdate = await updater.checkForUpdate(
      fixture.platform.name,
      fixture.architecture.name,
      '0.0.0',
      'stable'
    )
    const scopedUpdate = await updater.checkForUpdate(
      fixture.platform.name,
      fixture.architecture.name,
      '0.0.0',
      'stable',
      secondSoftware.slug
    )

    assert.equal(legacyUpdate?.id, legacyArtifact.id)
    assert.equal(scopedUpdate?.id, secondArtifact.id)
    assert.isNull(
      await new ArtifactRepository().findPublicById(secondArtifact.id, legacySoftware.id)
    )
    const scopedPublicArtifact = await new ArtifactRepository().findPublicById(
      secondArtifact.id,
      secondSoftware.id
    )
    assert.equal(scopedPublicArtifact?.id, secondArtifact.id)

    const softwareService = new SoftwareService(new SoftwareRepository())
    await softwareService.setDefault(secondSoftware.id)
    const resolvedPublicSoftware = await softwareService.resolvePublic()
    assert.equal(resolvedPublicSoftware?.id, secondSoftware.id)
    await assert.rejects(() => softwareService.toggleActive(secondSoftware.id))
    await softwareService.toggleActive(legacySoftware.id)
    await assert.rejects(() =>
      updater.getLatest(
        fixture.platform.name,
        fixture.architecture.name,
        'stable',
        legacySoftware.slug
      )
    )
  })

  test('PostgreSQL serializes concurrent default selections and enforces one active default', async ({
    assert,
  }) => {
    const original = await defaultSoftware()
    const service = new SoftwareService(new SoftwareRepository())
    const first = await service.create({ name: 'Concurrent first', slug: `first-${randomUUID()}` })
    const second = await service.create({
      name: 'Concurrent second',
      slug: `second-${randomUUID()}`,
    })
    await Promise.all([service.setDefault(first.id), service.setDefault(second.id)])
    const defaults = await db.from('software').where('is_default', true)
    assert.lengthOf(defaults, 1)
    await assert.rejects(() =>
      db.from('software').where('id', defaults[0].id).update({ is_active: false })
    )
    const alternate = defaults[0].id === first.id ? second.id : first.id
    await assert.rejects(() =>
      db.from('software').where('id', alternate).update({ is_default: true })
    )
    await service.setDefault(original.id)
  })

  test('PostgreSQL storage defaults serialize selection and exclude deleted rows from uniqueness', async ({
    assert,
  }) => {
    const firstFixture = await makeFixture()
    const secondFixture = await makeFixture()
    const first = firstFixture.storageProvider
    const second = secondFixture.storageProvider
    const service = new StorageProviderService(new StorageProviderRepository())
    await Promise.all([service.activateProvider(first.id), service.activateProvider(second.id)])
    const defaults = await StorageProvider.query().where('isDefault', true)
    assert.lengthOf(defaults, 1)
    const selected = defaults[0]
    const alternate = selected.id === first.id ? second : first
    await selected.delete()
    await db.from('storage_providers').where('id', alternate.id).update({ is_default: true })
    const currentDefault = await service.getDefaultProvider()
    assert.equal(currentDefault?.id, alternate.id)
    const historical = await db.from('storage_providers').where('id', selected.id).first()
    assert.isNotNull(historical.deleted_at)
    assert.isTrue(historical.is_default)
    await service.activateProvider(alternate.id)
  })

  test('artifact filenames use the owning software name', async ({ assert }) => {
    const fixture = await makeFixture()
    const productSuffix = randomUUID().slice(0, 8)
    const product = await Software.create({
      name: `Orbit Mobile ${productSuffix}`,
      slug: `orbit-mobile-${productSuffix}`,
      isActive: true,
      isDefault: false,
    })
    const version = await Version.create({
      softwareId: product.id,
      major: 4,
      minor: 5,
      patch: 6,
      codename: null,
      changelog: null,
      isActive: true,
      releaseDate: null,
    })
    const path = join(fixture.root, 'orbit.zip')
    const bytes = Buffer.from('orbit software artifact')
    await writeFile(path, bytes)
    const artifact = await makeArtifactService().uploadArtifact(multipartFile(path, bytes.length), {
      versionId: version.id,
      platformId: fixture.platform.id,
      architectureId: fixture.architecture.id,
      storageProviderId: fixture.storageProvider.id,
      channel: 'beta',
    })

    assert.match(artifact.fileName, /^Orbit-Mobile-/)
    const details = await makeArtifactService().getDetails(artifact.id, 1)
    assert.equal(artifactDetailsDto(details.artifact).version?.software?.slug, product.slug)
  })

  test('public local paths reject traversal and symlinks and details DTO excludes provider secrets', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const provider = new LocalProvider({ root: fixture.root })
    const outsideRoot = await mkdtemp(join(tmpdir(), 'reeva-outside-'))
    tempRoots.push(outsideRoot)
    await writeFile(join(outsideRoot, 'secret.txt'), 'not public')

    await assert.rejects(() => provider.getStream('../secret.txt'))
    await assert.rejects(() => provider.getStream('%2e%2e/secret.txt'))
    await symlink(outsideRoot, join(fixture.root, 'link'))
    await assert.rejects(() => provider.getStream('link/secret.txt'))

    fixture.storageProvider.config = {
      driver: 'local',
      root: fixture.root,
      accessKey: 'test-access-secret',
      secretKey: 'test-secret-value',
    }
    await fixture.storageProvider.save()
    const artifact = await makeArtifact(fixture)
    const details = await makeArtifactService().getDetails(artifact.id, 1)
    const serialized = JSON.stringify(artifactDetailsDto(details.artifact))
    assert.notInclude(serialized, 'test-access-secret')
    assert.notInclude(serialized, 'test-secret-value')
    assert.include(serialized, 'reeva')
    assert.include(attachmentDisposition('release\r\nX-Evil: yes.zip'), 'X-Evil: yes.zip')
    assert.notInclude(attachmentDisposition('release\r\nX-Evil: yes.zip'), '\r')
  })

  test('duplicate upload does not overwrite the first object and compensates a failed DB write', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const bytes = Buffer.from('first package bytes')
    const source = join(fixture.root, 'source.zip')
    await writeFile(source, bytes)
    const service = makeArtifactService()
    const first = await service.uploadArtifact(multipartFile(source, bytes.length), {
      versionId: fixture.version.id,
      platformId: fixture.platform.id,
      architectureId: fixture.architecture.id,
      storageProviderId: fixture.storageProvider.id,
      channel: 'stable',
      isPublished: true,
    })

    const firstKey = first.storageKey
    const secondBytes = Buffer.from('second package bytes')
    const secondSource = join(fixture.root, 'second.zip')
    await writeFile(secondSource, secondBytes)
    await assert.rejects(() =>
      service.uploadArtifact(multipartFile(secondSource, secondBytes.length), {
        versionId: fixture.version.id,
        platformId: fixture.platform.id,
        architectureId: fixture.architecture.id,
        storageProviderId: fixture.storageProvider.id,
        channel: 'stable',
      })
    )

    assert.deepEqual(await readFile(join(fixture.root, firstKey)), bytes)
    assert.equal(first.checksumSha256, createHash('sha256').update(bytes).digest('hex'))
    const storedFiles = await readdir(join(fixture.root, 'artifacts'), {
      recursive: true,
      withFileTypes: true,
    })
    assert.equal(storedFiles.filter((entry) => entry.isFile()).length, 1)
    const storedKeyCount = await db
      .from('artifacts')
      .where('storage_provider_id', fixture.storageProvider.id)
      .count('* as total')
      .first()
    assert.equal(Number(storedKeyCount?.total), 1)
    const reservations = await db
      .from('storage_upload_reservations')
      .where('storage_provider_id', fixture.storageProvider.id)
    assert.lengthOf(reservations, 0)
  })

  test('concurrent uploads reserve quota before writing objects', async ({ assert }) => {
    const fixture = await makeFixture({ quotaBytes: 150 })
    const nextVersion = await Version.create({
      softwareId: fixture.version.softwareId,
      major: 2,
      minor: 0,
      patch: 0,
      codename: null,
      changelog: null,
      isActive: true,
      releaseDate: null,
    })
    const filePath = join(fixture.root, 'quota.zip')
    await writeFile(filePath, Buffer.alloc(100, 7))
    const service = makeArtifactService()
    const upload = (versionId: string) =>
      service.uploadArtifact(multipartFile(filePath, 100), {
        versionId,
        platformId: fixture.platform.id,
        architectureId: fixture.architecture.id,
        storageProviderId: fixture.storageProvider.id,
        channel: 'beta',
      })

    const results = await Promise.allSettled([upload(fixture.version.id), upload(nextVersion.id)])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const usage = await db
      .from('artifacts')
      .where('storage_provider_id', fixture.storageProvider.id)
      .sum({ total: 'size_bytes' })
      .first()
    assert.isAtMost(Number(usage?.total || 0), 150)
  })

  test('a later upload retries cleanup of an expired storage object reservation', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const orphanId = randomUUID()
    const orphanKey = `artifacts/${orphanId}/payload`
    const provider = new LocalProvider({ root: fixture.root })
    await provider.upload(Readable.from(Buffer.from('orphaned bytes')), {
      key: orphanKey,
      fileName: 'payload',
      contentType: 'application/octet-stream',
      contentLength: 14,
    })
    await db.table('storage_upload_reservations').insert({
      id: orphanId,
      storage_provider_id: fixture.storageProvider.id,
      size_bytes: 14,
      expires_at: DateTime.utc().minus({ seconds: 1 }).toJSDate(),
      created_at: DateTime.utc().minus({ days: 8 }).toJSDate(),
    })

    const source = join(fixture.root, 'recovered.zip')
    await writeFile(source, 'valid package bytes')
    await makeArtifactService().uploadArtifact(multipartFile(source, 19), {
      versionId: fixture.version.id,
      platformId: fixture.platform.id,
      architectureId: fixture.architecture.id,
      storageProviderId: fixture.storageProvider.id,
      channel: 'stable',
    })

    await assert.rejects(() => readFile(join(fixture.root, orphanKey)))
    const remaining = await db.from('storage_upload_reservations').where('id', orphanId).first()
    assert.isNull(remaining)
  })

  test('storage failures release reservations and downloads do not depend on external geolocation', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const filePath = join(fixture.root, 'upload.zip')
    await writeFile(filePath, 'package bytes')

    const invalidRoot = join(fixture.root, 'root-is-a-file')
    await writeFile(invalidRoot, 'not a directory')
    fixture.storageProvider.config = { driver: 'local', root: invalidRoot }
    await fixture.storageProvider.save()
    await assert.rejects(() =>
      makeArtifactService().uploadArtifact(multipartFile(filePath, 13), {
        versionId: fixture.version.id,
        platformId: fixture.platform.id,
        architectureId: fixture.architecture.id,
        storageProviderId: fixture.storageProvider.id,
        channel: 'stable',
      })
    )
    assert.equal(
      await db
        .from('storage_upload_reservations')
        .where('storage_provider_id', fixture.storageProvider.id)
        .count('* as total')
        .first()
        .then((row) => Number(row?.total)),
      0
    )

    fixture.storageProvider.config = { driver: 'local', root: fixture.root }
    await fixture.storageProvider.save()
    const artifact = await makeArtifact(fixture)
    await mkdir(join(fixture.root, 'releases'), { recursive: true })
    await writeFile(join(fixture.root, artifact.storageKey), 'test')

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls++
      throw new Error('network timeout')
    }) as typeof fetch
    try {
      const { stream } = await makeUpdaterService().recordAndStream(
        artifact.id,
        '198.51.100.20',
        'audit-test'
      )
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      assert.equal(Buffer.concat(chunks).toString(), 'test')
      assert.equal(fetchCalls, 0)
    } finally {
      globalThis.fetch = originalFetch
    }

    const updated = await Artifact.findOrFail(artifact.id)
    assert.equal(updated.downloadCount, 1)
    const history = await db.from('download_histories').where('artifact_id', artifact.id).first()
    assert.isNull(history?.country_code)
  })

  test('download counters increment atomically under concurrent requests', async ({ assert }) => {
    const fixture = await makeFixture()
    const artifact = await makeArtifact(fixture)
    await mkdir(join(fixture.root, 'releases'), { recursive: true })
    await writeFile(join(fixture.root, artifact.storageKey), 'test')

    const service = makeUpdaterService()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.recordAndStream(artifact.id, '198.51.100.22'))
    )
    await Promise.all(
      results.map(async ({ stream }) => {
        for await (const chunk of stream) {
          // Consume each stream to model a completed client download and close
          // the underlying file handle before migration teardown.
          void chunk
        }
      })
    )

    const updated = await Artifact.findOrFail(artifact.id)
    assert.equal(updated.downloadCount, 12)
    const historyCount = await db
      .from('download_histories')
      .where('artifact_id', artifact.id)
      .count('* as total')
      .first()
    assert.equal(Number(historyCount?.total), 12)
  })

  test('a client disconnect or stream error preserves the accepted download count', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const artifact = await makeArtifact(fixture)
    await mkdir(join(fixture.root, 'releases'), { recursive: true })
    await writeFile(join(fixture.root, artifact.storageKey), 'test')

    const { stream } = await makeUpdaterService().recordAndStream(artifact.id, '127.0.0.1')
    const closed = new Promise<void>((resolve) => stream.once('close', resolve))
    stream.destroy(new Error('simulated client disconnect'))
    await closed

    const updated = await Artifact.findOrFail(artifact.id)
    assert.equal(updated.downloadCount, 1)
  })

  test('dashboard UTC activity buckets run on PostgreSQL', async ({ assert }) => {
    const fixture = await makeFixture()
    const artifact = await makeArtifact(fixture)
    await db.table('download_histories').insert({
      artifact_id: artifact.id,
      ip_address: '127.0.0.1',
      user_agent: 'audit-test',
      created_at: DateTime.utc().toJSDate(),
    })

    const service = new DashboardService(
      new VersionRepository(),
      new ArtifactRepository(),
      new StorageProviderRepository(),
      new DownloadHistoryRepository()
    )
    const dashboard = await service.getDashboardData()
    const downloadCount = await db.from('artifacts').sum('download_count as total').first()
    assert.equal(dashboard.stats.downloads, Number(downloadCount?.total || 0))
    assert.isAtLeast(dashboard.stats.today, 1)
    assert.isAtLeast(dashboard.allChartData.today.length, 1)
    assert.equal(dashboard.health.db, 'healthy')
    await db.table('download_histories').insert({
      artifact_id: artifact.id,
      ip_address: '127.0.0.1',
      user_agent: 'deleted-audit-test',
      created_at: DateTime.utc().toJSDate(),
      deleted_at: DateTime.utc().toJSDate(),
    })
    const afterDeletion = await service.getDashboardData()
    assert.equal(afterDeletion.stats.today, dashboard.stats.today)
    assert.deepEqual(afterDeletion.allChartData.today, dashboard.allChartData.today)
  })

  test('PostgreSQL license activation transactions enforce limits, scope removals and share signing keys', async ({
    assert,
  }) => {
    const service = new LicenseService(new LicenseRepository())
    const first = await service.createLicense({ productName: 'ORBIT', maxActivations: 1 })
    const second = await service.createLicense({ productName: 'Orbit', maxActivations: 3 })
    const attempts = await Promise.allSettled([
      service.issueActivationToken(first.id, 'machine-a'),
      service.issueActivationToken(first.id, 'machine-b'),
      service.issueActivationToken(second.id, 'same-machine'),
      service.issueActivationToken(second.id, 'same-machine'),
    ])
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 2)
    const firstRow = await License.findOrFail(first.id)
    const secondRow = await License.findOrFail(second.id)
    assert.equal(firstRow.activationCount, 1)
    assert.equal(secondRow.activationCount, 1)
    const publicKey = await Setting.query().where('key', 'license_public_key').firstOrFail()
    for (const attempt of attempts) {
      if (attempt.status !== 'fulfilled') continue
      const token = JSON.parse(Buffer.from(attempt.value, 'base64').toString())
      assert.isTrue(
        verify(
          undefined,
          Buffer.from(JSON.stringify(token.p)),
          publicKey.value!,
          Buffer.from(token.s, 'base64')
        )
      )
    }
    const activation = await LicenseActivation.query().where('licenseId', first.id).firstOrFail()
    await assert.rejects(() => service.removeActivation(second.id, activation.id))
    assert.isNotNull(await LicenseActivation.find(activation.id))
    await db.from('licenses').where('id', first.id).update({ activation_count: 999 })
    await service.removeActivation(first.id, activation.id)
    const removed = await License.findOrFail(first.id)
    assert.equal(removed.activationCount, 0)
    await assert.rejects(() => service.removeActivation(first.id, activation.id))
    const expired = await service.createLicense({
      productName: 'Expired',
      expiresAt: DateTime.utc().minus({ days: 1 }).toISO(),
    })
    await assert.rejects(() => service.issueActivationToken(expired.id, 'machine'))
    await assert.rejects(() => service.issueActivationToken(second.id, ''))
    const filtered = await service.getFilteredLicenses(1, 20, { productName: 'orbit' })
    assert.equal(filtered.total, 2)
    // Fail after the activation insert to exercise the real DB rollback boundary.
    await db.rawQuery(`CREATE FUNCTION reeva_test_license_failure() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'synthetic license persistence failure'; END;
        $$ LANGUAGE plpgsql`)
    await db.rawQuery(
      'CREATE TRIGGER reeva_test_license_failure BEFORE UPDATE ON licenses FOR EACH ROW EXECUTE FUNCTION reeva_test_license_failure()'
    )
    try {
      await assert.rejects(() => service.issueActivationToken(second.id, 'failed-machine'))
    } finally {
      await db.rawQuery('DROP TRIGGER reeva_test_license_failure ON licenses')
      await db.rawQuery('DROP FUNCTION reeva_test_license_failure()')
    }
    const failedActivation = await LicenseActivation.query()
      .where('licenseId', second.id)
      .where('machineId', 'failed-machine')
      .first()
    assert.isNull(failedActivation)
    const afterFailure = await License.findOrFail(second.id)
    assert.equal(afterFailure.activationCount, 1)
  })

  test('password reset tokens are hashed, expire, are single-use, and revoke sessions', async ({
    assert,
  }) => {
    const user = await User.create({
      email: `reset-${randomUUID()}@example.test`,
      fullName: null,
      passwordHash: 'old-password-at-least-12',
      isRoot: false,
      isActive: true,
      theme: 'system',
      accentColor: 0,
      authVersion: 0,
    })
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const now = DateTime.utc()
    await db.table('password_reset_tokens').insert({
      email: user.email,
      token: tokenHash,
      expires_at: now.plus({ hours: 1 }).toJSDate(),
      created_at: now.toJSDate(),
    })
    await db.table('remember_me_tokens').insert({
      tokenable_id: user.id,
      hash: 'test-token-hash',
      created_at: now.toJSDate(),
      updated_at: now.toJSDate(),
      expires_at: now.plus({ days: 30 }).toJSDate(),
    })

    const expiredToken = randomBytes(32).toString('hex')
    await db.table('password_reset_tokens').insert({
      email: user.email,
      token: createHash('sha256').update(expiredToken).digest('hex'),
      expires_at: now.minus({ minutes: 1 }).toJSDate(),
      created_at: now.minus({ hours: 2 }).toJSDate(),
    })

    const service = new AuthService(new UserRepository())
    await assert.rejects(() => service.updatePasswordByToken(expiredToken, 'another-new-password'))
    const newPasswords = ['new-password-number-one', 'new-password-number-two']
    const results = await Promise.allSettled(
      newPasswords.map((password) => service.updatePasswordByToken(rawToken, password))
    )
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)

    const passwordMatches = await Promise.all(
      newPasswords.map(async (password) => {
        try {
          await User.verifyCredentials(user.email, password)
          return true
        } catch {
          return false
        }
      })
    )
    assert.deepEqual(passwordMatches.sort(), [false, true])

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.authVersion, 1)
    const activeRows = await db.from('password_reset_tokens').where('email', user.email)
    assert.lengthOf(activeRows, 0)
    const rememberRows = await db.from('remember_me_tokens').where('tokenable_id', user.id)
    assert.lengthOf(rememberRows, 0)
  })

  test('auth throttling is shared by IP and identity and clears on successful login', async ({
    assert,
  }) => {
    const service = new AuthService(new UserRepository())
    const ip = `127.0.0.${Math.floor(Math.random() * 200) + 1}`
    const email = `${randomUUID()}@example.test`
    for (let attempt = 1; attempt <= 8; attempt++) {
      assert.isFalse(await service.isAuthRequestThrottled('login', ip, email))
    }
    assert.isTrue(await service.isAuthRequestThrottled('login', ip, email))
    await service.clearLoginAttempts(ip, email)
    assert.isFalse(await service.isAuthRequestThrottled('login', ip, email))

    const sprayIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const sprayedIdentities = Array.from(
      { length: 40 },
      (_, index) => `spray-${index}-${randomUUID()}@example.test`
    )
    const identityKeys = sprayedIdentities.map((identity) =>
      createHash('sha256').update(`login:identity:${identity}`).digest('hex')
    )
    for (const identity of sprayedIdentities) {
      await service.isAuthRequestThrottled('login', sprayIp, identity)
    }
    const storedIdentityKeys = await db
      .from('auth_rate_limits')
      .whereIn('key', identityKeys)
      .count('* as total')
      .first()
    assert.equal(Number(storedIdentityKeys?.total), 30)
  })

  test('disabled email prevents password reset token creation and explains the disabled state', async ({
    assert,
  }) => {
    let repositoryLookups = 0
    const authService = new AuthService({
      async findByEmail() {
        repositoryLookups++
        throw new Error('User lookup must not run while mail is disabled.')
      },
    } as unknown as UserRepository)
    authService.isMailEnabled = () => false
    await authService.sendPasswordResetLink('admin@example.test')
    assert.equal(repositoryLookups, 0)

    let redirectedBack = false
    let flashKey = ''
    let flashMessage = ''
    let sentResetEmail = false
    const controller = new SessionController({
      isMailEnabled: () => false,
      async isAuthRequestThrottled() {
        throw new Error('Rate-limit lookup should not run while mail is disabled.')
      },
      async sendPasswordResetLink() {
        sentResetEmail = true
      },
    } as unknown as AuthService)
    const context = {
      request: { input: () => 'admin@example.test' },
      session: {
        flash(key: string, message: string) {
          flashKey = key
          flashMessage = message
        },
      },
      response: {
        redirect() {
          return {
            back() {
              redirectedBack = true
            },
          }
        },
      },
      incomingIp: '127.0.0.1',
    } as unknown as HttpContext

    await controller.sendResetLink(context)
    assert.isTrue(redirectedBack)
    assert.equal(flashKey, 'error')
    assert.include(flashMessage, 'temporarily disabled')
    assert.isFalse(sentResetEmail)
  })

  test('API rejects invalid versions, channels, pagination, and IDs before service calls', async ({
    assert,
  }) => {
    let status = 200
    let body: unknown
    const response = {
      status(code: number) {
        status = code
        return this
      },
      json(value: unknown) {
        body = value
        return value
      },
      send(value: unknown) {
        body = value
        return value
      },
    }
    const controller = new UpdaterController({
      checkForUpdate: async () => null,
    } as unknown as UpdaterService)
    const call = async (
      method: 'check' | 'latest' | 'releases' | 'download',
      input: Record<string, unknown>,
      params = {}
    ) => {
      status = 200
      body = undefined
      const request = {
        input(name: string, fallback?: unknown) {
          return input[name] ?? fallback
        },
        header() {
          return undefined
        },
      }
      const context = {
        request,
        response,
        params,
        incomingIp: '127.0.0.1',
      } as unknown as HttpContext
      await controller[method](context as never)
      return { status, body }
    }

    const invalidVersion = await call('check', {
      platform: 'linux',
      arch: 'x64',
      version: 'latest',
    })
    const invalidChannel = await call('latest', {
      platform: 'linux',
      arch: 'x64',
      channel: 'production;drop',
    })
    const invalidPagination = await call('releases', {
      platform: 'linux',
      arch: 'x64',
      page: '0',
      limit: '200',
    })
    const invalidId = await call('download', {}, { id: 'not-a-uuid' })
    const noUpdate = await call('check', {
      platform: 'linux',
      arch: 'x64',
      version: '1.2.3',
    })
    assert.equal(invalidVersion.status, 400)
    assert.equal(invalidChannel.status, 400)
    assert.equal(invalidPagination.status, 400)
    assert.equal(invalidId.status, 404)
    assert.equal(noUpdate.status, 204)
  })

  test('version filter bounds numeric parts and rejects ambiguous wildcard operators', async ({
    assert,
  }) => {
    const service = new VersionService(
      new VersionRepository(),
      new ArtifactRepository(),
      new SoftwareRepository()
    )
    const software = await defaultSoftware()
    await assert.rejects(
      () =>
        service.getFilteredVersions(1, 10, {
          softwareId: software.id,
          versionNumber: `${'9'.repeat(50)}.0.0`,
        }),
      'Invalid semantic version filter.'
    )
    await assert.rejects(
      () =>
        service.getFilteredVersions(1, 10, { softwareId: software.id, versionNumber: '>=1.2.*' }),
      'Invalid semantic version filter.'
    )
  })

  test('root middleware denies non-root users and real IP middleware ignores spoofed headers', async ({
    assert,
  }) => {
    const closeServer = await testUtils.httpServer().start()
    try {
      const routes = Object.values(router.toJSON()).flat()
      const middlewareFor = (name: string) => {
        const route = routes.find((entry) => entry.name === name)
        return route ? Array.from(route.middleware.all(), (entry) => entry.name) : []
      }

      assert.include(middlewareFor('cms.dashboard'), 'auth')
      assert.include(middlewareFor('cms.profile.password'), 'auth')
      assert.notInclude(middlewareFor('cms.dashboard'), 'root')
      for (const route of [
        'cms.users.index',
        'cms.storage.index',
        'cms.settings.index',
        'cms.software.index',
      ]) {
        assert.include(middlewareFor(route), 'auth')
        assert.include(middlewareFor(route), 'root')
      }
      for (const route of [
        'api.check',
        'api.latest',
        'api.releases',
        'api.download',
        'api.software.check',
        'api.software.latest',
        'api.software.releases',
        'api.software.download',
      ]) {
        assert.notInclude(middlewareFor(route), 'auth')
        assert.notInclude(middlewareFor(route), 'root')
      }
    } finally {
      await closeServer()
    }

    let status = 200
    const response = {
      status(code: number) {
        status = code
        return this
      },
      send() {
        return 'denied'
      },
    }
    const middleware = new RootMiddleware()
    const denied = await middleware.handle(
      { auth: { user: { isRoot: false } }, response } as unknown as HttpContext,
      async () => 'allowed'
    )
    assert.equal(status, 403)
    assert.equal(denied, 'denied')

    const allowed = await middleware.handle(
      { auth: { user: { isRoot: true } }, response } as unknown as HttpContext,
      async () => 'allowed'
    )
    assert.equal(allowed, 'allowed')

    const ctx: { request: { ip: () => string; header: () => string }; incomingIp?: string } = {
      request: {
        ip: () => '::ffff:10.0.0.8',
        header: () => '203.0.113.9',
      },
    }
    await new RealIpMiddleware().handle(ctx as unknown as HttpContext, async () => undefined)
    assert.equal(ctx.incomingIp, '10.0.0.8')
  })

  test('missing local object maps to a storage failure, not an unpublished download', async ({
    assert,
  }) => {
    const fixture = await makeFixture()
    const artifact = await makeArtifact(fixture)
    await assert.rejects(
      () => makeUpdaterService().recordAndStream(artifact.id, '127.0.0.1'),
      ArtifactStorageError
    )
  })
})

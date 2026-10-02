import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
import Version from '#models/version'
import ArtifactRepository from '#repositories/artifact_repository'
import ArchitectureRepository from '#repositories/architecture_repository'
import DownloadHistoryRepository from '#repositories/download_history_repository'
import PlatformRepository from '#repositories/platform_repository'
import SoftwareRepository from '#repositories/software_repository'
import StorageProviderRepository from '#repositories/storage_provider_repository'
import UserRepository from '#repositories/user_repository'
import VersionRepository from '#repositories/version_repository'
import ArtifactService, { artifactDetailsDto } from '#services/artifact_service'
import DashboardService from '#services/dashboard_service'
import AuthService from '#services/auth_service'
import { attachmentDisposition } from '#services/download_headers'
import UpdaterService, { ArtifactStorageError } from '#services/updater_service'
import VersionService from '#services/version_service'
import SoftwareService from '#services/software_service'
import LocalProvider from '#services/storage/providers/local_provider'
import UpdaterController from '#controllers/api/updater_controller'
import RootMiddleware from '#middleware/root_middleware'
import RealIpMiddleware from '#middleware/real_ip_middleware'
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

  test('dashboard activity buckets run on SQLite', async ({ assert }) => {
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
  })

  test('password reset tokens are hashed, expire, are single-use, and revoke sessions', async ({
    assert,
  }) => {
    const user = await User.create({
      email: `reset-${randomUUID()}@example.test`,
      fullName: null,
      passwordHash: await hash.make('old-password-at-least-12'),
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
    const results = await Promise.allSettled([
      service.updatePasswordByToken(rawToken, 'new-password-number-one'),
      service.updatePasswordByToken(rawToken, 'new-password-number-two'),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)

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

import { ArtifactSchema } from '#database/schema'
import { beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { compose } from '@adonisjs/core/helpers'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import Version from './version.js'
import Platform from './platform.js'
import Architecture from './architecture.js'
import StorageProvider from './storage_provider.js'

export default class Artifact extends compose(ArtifactSchema, SoftDeletes) {

  @column({ columnName: 'checksum_md5' })
  declare checksumMd5: string | null

  @column({ columnName: 'checksum_sha1' })
  declare checksumSha1: string | null

  @column({ columnName: 'checksum_sha256' })
  declare checksumSha256: string | null

  @column({ columnName: 'checksum_sha512' })
  declare checksumSha512: string | null

  @belongsTo(() => Version)
  declare version: BelongsTo<typeof Version>

  @belongsTo(() => Platform)
  declare platform: BelongsTo<typeof Platform>

  @belongsTo(() => Architecture)
  declare architecture: BelongsTo<typeof Architecture>

  @belongsTo(() => StorageProvider)
  declare storageProvider: BelongsTo<typeof StorageProvider>

  @beforeCreate()
  static async generateUuid(artifact: Artifact) {
    if (!artifact.id) {
      artifact.id = randomUUID()
    }
  }
}
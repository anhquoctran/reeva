import { DownloadHistorySchema } from '#database/schema'
import { beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import { SoftDeletes } from '#models/mixins/soft_deletes'
import { compose } from '@adonisjs/core/helpers'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import Artifact from './artifact.js'

export default class DownloadHistory extends compose(DownloadHistorySchema, SoftDeletes) {

  @belongsTo(() => Artifact)
  declare artifact: BelongsTo<typeof Artifact>

  @beforeCreate()
  static async generateUuid(history: DownloadHistory) {
    if (!history.id) {
      history.id = randomUUID()
    }
  }
}

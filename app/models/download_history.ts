import { DownloadHistorySchema } from '#database/schema'
import { beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import Artifact from './artifact.js'

export default class DownloadHistory extends DownloadHistorySchema {
  @belongsTo(() => Artifact)
  declare artifact: BelongsTo<typeof Artifact>

  @beforeCreate()
  static async generateUuid(history: DownloadHistory) {
    if (!history.id) {
      history.id = randomUUID()
    }
  }
}

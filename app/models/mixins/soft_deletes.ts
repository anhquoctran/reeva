import { NormalizeConstructor } from '@adonisjs/core/types/helpers'
import { BaseModel, beforeFind, beforeFetch } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { DateTime } from 'luxon'

export function SoftDeletes<T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) {
  class SoftDeletesModel extends superclass {
    @beforeFind()
    static ignoreDeleted(query: ModelQueryBuilderContract<typeof BaseModel>) {
      query.whereNull(`${query.model.table}.deleted_at`)
    }

    @beforeFetch()
    static ignoreDeletedFetch(query: ModelQueryBuilderContract<typeof BaseModel>) {
      query.whereNull(`${query.model.table}.deleted_at`)
    }

    async delete() {
      ;(this as any).deletedAt = DateTime.now()
      await this.save()
    }

    async restore() {
      ;(this as any).deletedAt = null
      await this.save()
    }

    async forceDelete() {
      await super.delete()
    }

    get trashed() {
      return (this as any).deletedAt !== null
    }
  }
  return SoftDeletesModel
}

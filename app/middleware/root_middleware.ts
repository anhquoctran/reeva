import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/** Restricts high-impact administration to explicitly designated root users. */
export default class RootMiddleware {
  async handle({ auth, response }: HttpContext, next: NextFn) {
    if (!auth.user?.isRoot) {
      return response.status(403).send('Forbidden')
    }

    return next()
  }
}

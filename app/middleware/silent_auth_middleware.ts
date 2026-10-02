import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Silent auth middleware can be used as a global middleware to silent check
 * if the user is logged-in or not.
 *
 * The request continues as usual, even when the user is not logged-in.
 */
export default class SilentAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const authenticated = await ctx.auth.check()
    const guard = ctx.auth.use('web')
    if (authenticated && guard.viaRemember && ctx.auth.user) {
      ctx.session.put('authVersion', ctx.auth.user.authVersion)
    }

    return next()
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class RealIpMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // request.ip() only uses forwarded headers when the HTTP server is
    // explicitly configured to trust the connecting proxy.
    ctx.incomingIp = this.normalizeIp(ctx.request.ip())
    await next()
  }

  normalizeIp(ip: string) {
    if (ip === '::1') return '127.0.0.1'
    if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '')
    return ip
  }
}

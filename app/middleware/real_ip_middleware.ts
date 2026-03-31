import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class RealIpMiddleware {
  
  async handle(ctx: HttpContext, next: NextFn) {

    const { request } = ctx

    let ip =
      request.header('cf-connecting-ip') ||
      request.header('x-real-ip') ||
      request.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.ip()

    // Normalize
    ip = this.normalizeIp(ip)

    ctx.incomingIp = ip
    await next()
  }

  normalizeIp(ip: string) {
    if (ip === '::1') return '127.0.0.1'
    if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '')
    return ip
  }
}
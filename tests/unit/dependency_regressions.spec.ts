import { test } from '@japa/runner'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const braces = require('braces') as (pattern: string) => string[]

test.group('dependency security regressions', () => {
  test('IPv4-mapped short IPv6 prefixes do not trust unrelated IPv4 peers', ({ assert }) => {
    const coreRequire = createRequire(require.resolve('@adonisjs/core'))
    const httpRequire = createRequire(coreRequire.resolve('@adonisjs/http-server'))
    const proxy = httpRequire('proxy-addr') as {
      compile: (subnet: string) => (ip: string) => boolean
    }
    assert.isFalse(proxy.compile('::ffff:10.0.0.0/8')('203.0.113.99'))
    assert.isTrue(proxy.compile('10.0.0.0/8')('10.1.2.3'))
    assert.isFalse(proxy.compile('10.0.0.0/8')('203.0.113.99'))
  })

  test('nested copies stop at the configured bound', ({ assert }) => {
    const prettyRequire = createRequire(require.resolve('pino-pretty'))
    const { copy } = prettyRequire('fast-copy') as { copy: (value: unknown) => unknown }
    const input: Record<string, unknown> = {}
    let cursor = input
    for (let index = 0; index < 2000; index++) {
      const child = {}
      cursor.next = child
      cursor = child
    }
    assert.throws(() => copy(input), /Maximum copy depth of 1000 exceeded/)
    assert.deepEqual(copy({ release: { version: '1.2.3' } }), { release: { version: '1.2.3' } })
  })

  test('deeply nested brace patterns fail at a bounded depth', ({ assert }) => {
    const pattern = `${'{'.repeat(2000)}payload${'}'.repeat(2000)}`

    assert.deepEqual(braces('{alpha,beta}'), ['(alpha|beta)'])
    assert.throws(() => braces(pattern), /Brace nesting depth exceeds maximum \(100\)/)
  })
})

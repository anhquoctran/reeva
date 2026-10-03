import { test } from '@japa/runner'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const braces = require('braces') as (pattern: string) => string

test.group('dependency security regressions', () => {
  test('deeply nested brace patterns fail at a bounded depth', ({ assert }) => {
    const pattern = `${'{'.repeat(2000)}payload${'}'.repeat(2000)}`

    assert.equal(braces('{alpha,beta}'), '(alpha|beta)')
    assert.throws(() => braces(pattern), /Brace nesting depth exceeds maximum \(100\)/)
  })
})

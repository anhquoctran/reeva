import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

// Accept only the known version-based advisory whose installed implementation
// is explicitly patched and whose bound is checked here. New advisories fail CI.
const require = createRequire(import.meta.url)
const braces = require('braces')
const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
assert.match(workspace, /braces@3\.0\.3: patches\/braces@3\.0\.3\.patch/)
assert.deepEqual(braces('{alpha,beta}'), ['(alpha|beta)'])
assert.throws(
  () => braces('{'.repeat(2000) + 'x' + '}'.repeat(2000)),
  /Brace nesting depth exceeds maximum \(100\)/
)

const result = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8', timeout: 120000 })
if (result.error || ![0, 1].includes(result.status))
  throw new Error('Dependency audit could not complete.')
const report = JSON.parse(result.stdout)
if (report.error || !report.advisories || !report.metadata)
  throw new Error('Unexpected dependency audit response.')
let mitigated = 0
let unresolved = 0
for (const advisory of Object.values(report.advisories)) {
  if (
    advisory.github_advisory_id === 'GHSA-vfj7-8cjw-p6xm' &&
    advisory.module_name === 'braces' &&
    advisory.findings?.every((finding) => finding.version === '3.0.3')
  ) {
    mitigated++
    console.log(
      `${advisory.github_advisory_id}: reported by version; installed depth-bound patch verified.`
    )
  } else {
    unresolved++
    console.error(
      `${advisory.github_advisory_id || advisory.id}: ${advisory.severity} ${advisory.module_name}`
    )
  }
}
console.log(
  `Dependency audit: ${unresolved} unresolved advisories, ${mitigated} locally mitigated advisory.`
)
if (unresolved) process.exitCode = 1

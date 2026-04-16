import type { ApplicationService } from '@adonisjs/core/types'
import { execSync } from 'node:child_process'
import edge from 'edge.js'

export default class AppInfoProvider {
  constructor(protected app: ApplicationService) {}

  public register() {}

  public async boot() {
    let gitSha1 = 'unknown'
    let gitCommitShort = 'unknown'
    try {
      gitSha1 = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
      gitCommitShort = gitSha1.substring(0, 8)
    } catch {
      // Not a git repo or git not available
    }

    const version = this.app.version?.version ?? '0.0.0'

    // Share as global view data available in all Edge templates
    edge.global('appInfo', {
      name: 'Reeva',
      version,
      gitSha1,
      gitCommitShort,
      versionString: `v${version} (${gitCommitShort})`,
      year: new Date().getFullYear(),
    })
  }

  public async ready() {}
  public async shutdown() {}
}

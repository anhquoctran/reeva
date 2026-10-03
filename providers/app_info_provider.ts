import type { ApplicationService } from '@adonisjs/core/types'
import edge from 'edge.js'
import { shutdownS3CompatibleClients } from '#services/storage/providers/s3_compatible_provider'

export default class AppInfoProvider {
  constructor(protected app: ApplicationService) {}

  public register() {}

  public async boot() {
    const candidateGitSha = process.env.APP_GIT_SHA?.trim()
    const gitSha1 =
      candidateGitSha && /^[0-9a-f]{7,40}$/i.test(candidateGitSha) ? candidateGitSha : 'unknown'
    const gitCommitShort = gitSha1 === 'unknown' ? 'unknown' : gitSha1.substring(0, 8)

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
  public async shutdown() {
    shutdownS3CompatibleClients()
  }
}

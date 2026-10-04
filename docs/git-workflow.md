# Git strategy and contribution flow

Reeva uses a lightweight **GitHub Flow / trunk-based** model. `master` is the
single integration and release branch. Work happens on short-lived branches
and returns to `master` through pull requests. We do not maintain a permanent
`develop` branch or routine release branches.

This keeps the release path aligned with the repository's existing CI: the
`verify` CI job runs on both pushes and pull requests. Code releases of
Reeva are separate from OTA software versions managed inside Reeva.

Coding agents should load the root `AGENTS.md` before Git operations. Cursor
and GitHub Copilot entry-point instructions point back to this workflow so
there is one policy source to maintain.

## Branches

### Protected branch

- `master` is the default branch and must remain buildable and deployable.
- Do not commit or push directly to `master`; open a pull request instead.
- Never force-push to, delete, or rewrite `master`.
- Merge only after the required CI check passes and review conversations are
  resolved.

### Work branches

Create a branch from the latest `origin/master`. Use a lowercase prefix and a
short kebab-case description. An issue number is optional, but when present it
goes immediately after the slash.

| Prefix | Use |
| --- | --- |
| `feat/` | User-visible capability or behavior |
| `fix/` | Bug fix |
| `security/` | Security fix or hardening |
| `hotfix/` | Urgent production fix; still merged through a PR |
| `refactor/` | Internal restructuring without intended behavior change |
| `perf/` | Performance improvement |
| `docs/` | Documentation only |
| `test/` | Test coverage or test infrastructure |
| `build/` | Build or packaging changes |
| `ci/` | Continuous integration changes |
| `deps/` | Dependency updates made by a person |
| `chore/` | Maintenance that does not fit another category |

Examples: `feat/142-software-scoped-api`, `fix/download-archive-check`,
`security/reset-token-replay`, `docs/git-workflow`.

Start a branch with:

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git switch -c feat/142-software-scoped-api
git push -u origin feat/142-software-scoped-api
```

Bot-generated `dependabot/*` branches are allowed. `codex/*` may be used for
agent-assisted work, but the branch must still follow the same review and CI
rules. A `release/*` branch is not part of normal flow; use one only for an
explicitly approved release freeze with a defined end date.

Keep branches focused and short-lived. Before opening a PR, bring the branch
up to date with `origin/master`. Rebase only a branch that you own; for a
shared branch, coordinate before rewriting its history. If rewriting your own
remote topic branch is necessary, use `--force-with-lease`. Never use plain
`--force` and never rewrite `master`.

## Commit messages

Use Conventional Commits:

```text
<type>(<scope>): <imperative summary>
```

Use a lowercase scope when it clarifies the affected area. Keep the summary
short, imperative, and specific. Common types are `feat`, `fix`, `refactor`,
`perf`, `docs`, `test`, `build`, `ci`, `chore`, `deps`, and `revert`.

Examples:

```text
feat(storage): encrypt provider credentials at rest
fix(ota): reject downloads for archived releases
docs(api): clarify pagination parameters
```

Mark incompatible changes with `!` and explain the migration in the commit
body, for example `feat(api)!: scope releases by software`. Never include
credentials, personal data, generated artifacts, or unrelated cleanup in a
commit. The pull request title should follow the same format because it becomes
the squash-merge commit message.

## Pull request flow

1. Branch from an up-to-date `origin/master` and make one coherent change.
2. Run the checks relevant to the change. For application changes, run at
   least `pnpm typecheck`, `pnpm lint`, and `pnpm test`; also run
   `pnpm build` for production/build/runtime changes. Follow the CI workflow
   for database, Docker, storage, and migration changes.
3. Open a PR targeting `master`. Explain the behavior, user impact, tests and
   any operational or migration steps. Mark incomplete work as a draft.
4. Get review and a passing `verify` status check. Resolve review conversations
   before merging.
5. Use **Squash and merge**. Delete the topic branch after merge.

Do not bypass failed or pending checks. If an urgent incident makes the normal
review path impossible, record the reason, scope, and follow-up review in the
incident/change record; do not treat routine administrative bypass as normal
flow.

### Pull request checklist

- [ ] The PR has one clear purpose and a Conventional Commit title.
- [ ] Tests and checks are listed with their actual results.
- [ ] API/client, environment, and deployment changes are documented.
- [ ] Database changes use additive migrations and cover fresh and upgrade
      paths where applicable.
- [ ] Dependency changes include the matching `pnpm-lock.yaml` update.
- [ ] No secrets, user data, local environment files, or debug output are
      included.

## Releases and hotfixes

- A normal release is cut from a reviewed, passing commit on `master` and is
  tagged `vMAJOR.MINOR.PATCH` (for example, `v1.4.0`). Use SemVer: increment
  MAJOR for incompatible public contracts, MINOR for backward-compatible
  capabilities, and PATCH for compatible fixes.
- Publish release notes that summarize changes, required configuration or
  migration steps, and known limitations. Do not move or reuse a published
  version tag.
- Do not create a release branch for an ordinary release. For a genuine
  release freeze, create a temporary `release/<version>` branch from `master`,
  accept only release-blocking fixes through PRs, then tag the approved commit
  and close the branch.
- A hotfix starts from current `master`, uses `hotfix/*`, and follows the same
  PR, review, and CI requirements. After merge, cut a patch release and verify
  the fix on the deployed version.
- Database migrations must preserve existing installations and be compatible
  with the deployment order. OTA versions configured by Reeva users are
  independent of Reeva's Git tags.

## Repository settings to enforce

Configure the GitHub ruleset for `master` to require pull requests, the
`verify` status check from the `CI` workflow, and resolved review conversations.
Disallow force pushes and branch deletion. Require one approval when another
maintainer is available. Restrict bypass permissions to a documented emergency
path rather than routine administrator pushes. Enable squash merge and disable
merge commits and rebase merge to match this policy. Protect `v*` tags from
update and deletion.

The last observed direct push to `master` was accepted even though GitHub
reported a pull-request-only rule, indicating a configured bypass path. The
ruleset should be reviewed so the repository enforces this documented flow;
this file alone does not change GitHub's remote settings.

Agent instruction files provide context, not technical enforcement. Keep the
GitHub ruleset and required `verify` check enabled; if a tool does not load the
repository instructions automatically, configure that tool to include
`AGENTS.md` before it starts work.

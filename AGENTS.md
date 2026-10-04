# Instructions for coding agents

Before creating or renaming branches, rebasing, cherry-picking, committing,
opening a PR, tagging a release, or pushing, read
[`docs/git-workflow.md`](docs/git-workflow.md). It is the source of truth for
branch names, commit messages, PR review, merge, and release rules.

- Work on a short-lived topic branch from `origin/master`, using one of the
  documented prefixes. Target PRs at `master` and use Conventional Commit
  titles/messages.
- Do not commit or push directly to `master`, rewrite it, or bypass GitHub
  branch protection. Require the `verify` CI check and review before merge;
  squash-merge PRs.
- Inspect `git status` before Git operations. Preserve existing user changes;
  never reset, clean, or overwrite them to make a branch operation easier.
- If a requested Git operation conflicts with the documented protected-branch
  flow, explain the conflict and use the PR path. Do not use an administrative
  bypass to force the operation through.

These instructions guide agents; GitHub rulesets and required CI checks are the
enforcement layer. Do not claim a rule is enforced remotely unless verified in
the repository settings.

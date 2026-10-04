For all Git operations, first follow the root `AGENTS.md` and
`docs/git-workflow.md`. Reeva uses short-lived topic branches and PRs into
`master`; do not commit or push directly to `master`, rewrite it, or bypass
branch protection. Preserve existing user changes. Require review and the
`verify` CI check, then squash-merge.

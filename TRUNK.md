# Trunk-Based Development

This is a single-developer repository. All work lands on `main` directly.

- Commit to `main` and push with `git push origin main`.
- Do not create, push, or open PRs from feature branches unless the owner explicitly requests an exception for a specific change.
- The `.githooks/pre-push` guard rejects pushes of any branch other than `main`; bypass only with `--no-verify` when the owner approves an exception.
- Use separate git worktrees only to isolate uncommitted local state, and land their commits back on `main` promptly.

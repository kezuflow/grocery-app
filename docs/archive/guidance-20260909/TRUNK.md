# Trunk-Based Development

Engineering checks and evidence requirements are defined in [TESTING.md](docs/architecture/TESTING.md). Inspect the working-tree diff, stage only intended changes, and preserve unrelated work. Trunk policy chooses where work lands; it does not authorize an unrelated deployment or destructive environment reset.

This is a single-developer repository. All work lands on `main` directly.

- Commit to `main` and push with `git push origin main`.
- Do not create, push, or open PRs from feature branches unless the owner explicitly requests an exception for a specific change.
- The `.githooks/pre-push` guard rejects pushes of any branch other than `main`; bypass only with `--no-verify` when the owner approves an exception.
- Use separate git worktrees only to isolate uncommitted local state, and land their commits back on `main` promptly.

## Local convention checks (no GitHub-side checks)

- Every **commit** runs locally via `.githooks`: `commit-msg` validates the commit-message convention; `pre-commit` validates file/path naming conventions.
- Every **push** runs locally via `.githooks/pre-push`: the trunk guard (main only), file naming conventions, and commit-message conventions for the full pushed range.
- The GitHub Actions commit-message workflow was removed; all enforcement is local. `git push --no-verify` bypasses only for owner-approved exceptions.

## What hooks do not prove

The hooks do not run the full type, lint, test, or build suites. Run the checks appropriate to the change before declaring it complete. Do not bypass hooks to conceal a failure or widen allow-lists to accommodate a new violation. Report existing unrelated failures separately from regressions. Schema migration strategy follows the pre-launch/retained-deployment policy in [CODING_STANDARDS.md](docs/architecture/CODING_STANDARDS.md), independently of Git commit history.

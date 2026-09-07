# Harness Quality Checkpoint

Status: completed. Updated 2026-09-07 12:20:54 UTC. This is descriptive recovery evidence, not product-policy authority.

## Task and workspace

Owner request: review architecture, agent instructions, coding standards, and quality tooling; improve the harness for GPT-6 Astra at Medium effort before resuming commerce implementation.

Observed starting HEAD: `f5383a9` on the existing checkout. Earlier documentation edits and partial staff-invitation implementation, including migration `0068_staff_invitation_grants.sql`, were already present. This task owns only the harness/configuration/documentation changes described below. It does not establish completion of any commerce phase.

## Findings and changes

- Architecture and security enumeration used tracked files only. New files could pass both commands before staging without being inspected. Both now use shared tracked/untracked working-tree discovery; temporary Git fixtures prove rejection, repair, ignore/deletion behavior, and failure outside a repository.
- Root `pnpm check` omitted the guardrail scripts' own tests. Added `pnpm harness:test` and included it in the aggregate.
- Added repository Codex defaults for `gpt-6-astra` / `medium`. Explicit host/session choices can override them; existing task model selection was not changed or verified by writing this file.
- Added a routed execution/recovery workflow, task-specific checkpoint convention, targeted verification guidance, and explicit authorization/context boundaries. Preserved architecture and business invariants.
- Optional phase review could select the wrong plan by number, overwrite another plan's report, and request reports while its reviewer prohibited all writes. Added plan identity to report paths and reconciled scoped report-writing permission. These are host instruction changes, not proof of a Claude execution run.

## Validation and next action

Executed against this task's working-tree changes above `f5383a9`:

- `pnpm harness:test`: 25 tests passed, zero failed. Negative fixtures reject unsafe code and accept its repair without staging violations in this checkout.
- `pnpm architecture:check`, `pnpm readiness:check`, `pnpm naming:check`, and `pnpm terminology:check`: passed.
- `pnpm exec oxlint` on the four changed/new harness scripts: passed without diagnostics.
- `pnpm exec oxfmt --check` on the 13 explicitly formatted harness/code/guide files: passed. The large architecture document received only the targeted enforcement paragraph edit, not a whole-file reformat.
- `git diff --check`: passed. Local document-link inspection checked 27 links; manifest/default-setting assertions and the root instruction-size check passed.
- Reviewed the diff and compared captured baseline hashes: pre-existing staff-invitation files and other captured application files are unchanged. Changes belong to instructions, project model defaults, root test wiring, verifier scripts, regression fixtures, and this checkpoint. No application code or schema was edited by this task.

No harness work remains. Full `pnpm check`, application suites/builds, browser/provider acceptance, actual new-session model selection, and execution of the Claude review tool were not performed. No measured model-versus-model quality comparison is claimed. The next commerce task should inspect the existing partial implementation and resume the owner's selected plan using the recovery workflow; this checkpoint does not mark a commerce phase complete.

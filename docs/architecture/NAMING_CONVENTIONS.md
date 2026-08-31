# FreshMarkets Naming Conventions

Repository path, migration, documentation, and workspace-package conventions are enforced locally by `pnpm naming:check`. The checker is intentionally structural and dependency-free so it can run early in CI. TypeScript identifier casing remains enforced through TypeScript, linting, and review.

## Files And Directories

- Source directories and static source files use lowercase kebab-case: `core-client`, `state-machines.ts`.
- Test files keep the source name and add `.test` before the extension: `service.test.ts`, `page.test.tsx`.
- React component identifiers use PascalCase in code; their filenames remain lowercase kebab-case.
- Next/vinext route conventions are allowed where required: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `middleware.ts`, and dynamic segments such as `[slug]`, `[...path]`, and `[[...path]]`.
- Type declaration files may use the generated `worker-configuration.d.ts` name.
- Documentation filenames use uppercase kebab-free names already established by the repository, such as `ARCHITECTURE.md`; new canonical docs should use uppercase letters and underscores only when matching an existing document family.
- User-approved Superpowers execution plans may use the standard dated lowercase form `docs/superpowers/plans/YYYY-MM-DD-lowercase-kebab.md`; they are implementation artifacts rather than canonical architecture/product documents.

## Database And Packages

- D1 migration files use four digits, an underscore, and lowercase snake_case: `0007_add_refund_indexes.sql`.
- SQL table and column names use lowercase snake_case.
- Workspace package names use the `@freshmarkets/*` scope and a lowercase kebab-case package name.
- TypeScript/JavaScript identifiers use `camelCase`; types, classes, and React components use `PascalCase`; constants use `UPPER_SNAKE_CASE` only for true constants.
- Public contract fields use camelCase even when their D1 storage columns use snake_case.

## Verification Scope

The local checker validates source/config/documentation paths and package manifests while ignoring generated output, dependencies, caches, and local runtime state. It reports every violation with the expected rule and exits non-zero so it can gate commits and GitHub Actions.

## Commit Messages

New commits use the Conventional Commits format:

```text
<type>(<optional-scope>): <imperative description>
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, and `test`. Use `!` before the colon for a breaking change, for example `feat(api)!: replace the catalog response`. Descriptions must be non-empty and must not end with a period.

Run `pnpm commit:check` to validate `HEAD`. Run `pnpm hooks:install` once per clone to enable the repository-managed `.githooks/commit-msg` hook for new commits. Existing history predating this rule is not rewritten automatically.

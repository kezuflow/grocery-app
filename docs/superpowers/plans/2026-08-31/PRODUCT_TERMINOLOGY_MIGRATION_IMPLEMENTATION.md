# Product Terminology Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete product-stage label across active repository material while preserving immutable migration identities and genuinely historical records.

**Architecture:** This is a repository-language migration, not a behavior change. Rename the canonical scope document, update every active router/reference, and use a reviewed allowlist for historical exceptions so future checks can distinguish intentional history from stale terminology.

**Tech Stack:** Markdown, TypeScript test names, Playwright, Node.js repository checks, Git

**Spec:** `docs/superpowers/specs/2026-08-31/COMMERCE_PRICING_PAYMENTS_CANCELLATION_DESIGN.md`

## Global Constraints

- Rename the canonical product scope to `docs/product/PRODUCT_SCOPE.md`.
- Use `product scope`, `initial launch`, or `current release` according to context.
- Never rename an applied D1 migration or rewrite Git history.
- Historical wording is allowed only when the file explicitly describes that historical phase.
- Do not edit Admin Dashboard or Maps implementation files.

---

### Task 1: Canonical scope document and routers

**Files:**
- Rename: `docs/product/MVP_SCOPE.md` -> `docs/product/PRODUCT_SCOPE.md`
- Modify: `AGENTS.md`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: existing canonical documentation router
- Produces: canonical `docs/product/PRODUCT_SCOPE.md` path and current-release terminology

- [ ] **Step 1: Capture the failing reference inventory**

```powershell
rg -n -i "\bmvp\b|MVP_SCOPE\.md" AGENTS.md docs/architecture docs/product
```

Expected: matches include the old filename and active fixed-stage language.

- [ ] **Step 2: Rename the canonical scope file**

```powershell
git mv docs/product/MVP_SCOPE.md docs/product/PRODUCT_SCOPE.md
```

- [ ] **Step 3: Update active canonical language**

Use these exact replacements by meaning:

```text
MVP scope                  -> product scope
MVP launch                 -> initial launch
for MVP                    -> for the current release
MVP may initially          -> the current release may initially
MVP_SCOPE.md               -> PRODUCT_SCOPE.md
```

Do not mechanically replace substrings inside applied migration names.

- [ ] **Step 4: Verify canonical references**

```powershell
rg -n "PRODUCT_SCOPE\.md" AGENTS.md docs/architecture docs/product
rg -n -i "\bmvp\b|MVP_SCOPE\.md" AGENTS.md docs/architecture docs/product
```

Expected: the first command finds every router; the second returns only reviewed historical passages, if any.

- [ ] **Step 5: Commit**

```powershell
git add AGENTS.md docs/architecture docs/product
git commit -m "docs(product): adopt current product terminology"
```

### Task 2: Active code, test, and README terminology

**Files:**
- Rename: `apps/web/tests/customer-mvp-journey.spec.ts` -> `apps/web/tests/customer-launch-journey.spec.ts`
- Modify: `apps/core/README.md`
- Modify: `apps/web/README.md`
- Modify: active comments and test descriptions returned by the inventory command

**Interfaces:**
- Consumes: `PRODUCT_SCOPE.md` terminology from Task 1
- Produces: unchanged runtime/test behavior with current naming

- [ ] **Step 1: Inventory active source matches**

```powershell
rg -n -i "\bmvp\b" apps packages scripts --glob '!apps/core/migrations/**'
```

Expected: active comments, descriptions, or filenames that need current-release wording.

- [ ] **Step 2: Rename the customer journey test and update descriptions**

```powershell
git mv apps/web/tests/customer-mvp-journey.spec.ts apps/web/tests/customer-launch-journey.spec.ts
```

Replace test titles and active comments without changing assertions, selectors, imports, or runtime symbols.

- [ ] **Step 3: Run the renamed journey**

```powershell
pnpm --filter @freshmarkets/web test:e2e -- customer-launch-journey.spec.ts
```

Expected: the same journey passes under the new filename.

- [ ] **Step 4: Run source checks**

```powershell
pnpm naming:check
pnpm --filter @freshmarkets/web typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit**

```powershell
git add apps packages scripts
git commit -m "chore(product): rename active launch references"
```

### Task 3: Historical exception audit and enforcement

**Files:**
- Create: `scripts/verify-product-terminology.mjs`
- Modify: `package.json`
- Modify: historical reports only when they incorrectly describe the current product
- Test: `scripts/verify-product-terminology.mjs` through the root check command

**Interfaces:**
- Consumes: active-source cleanup from Tasks 1-2
- Produces: `pnpm terminology:check`

- [ ] **Step 1: Add the failing check to the root script surface**

```json
{
  "scripts": {
    "terminology:check": "node scripts/verify-product-terminology.mjs"
  }
}
```

Run:

```powershell
pnpm terminology:check
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 2: Implement the verifier**

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const stageLabel = /\bmvp\b/i;
const immutableMigration = /^apps\/core\/migrations\/0047_customer_mvp_completion\.sql$/i;
const historicalDocument = /^docs\/superpowers\/(plans|reports)\/(?:\d{4}-\d{2}-\d{2}\/)?/i;
const enforcementSource = "scripts/verify-product-terminology.mjs";
const violations = [];
const allowed = [];

for (const file of tracked) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!stageLabel.test(content) && !stageLabel.test(file)) continue;
  if (immutableMigration.test(file) || historicalDocument.test(file) || file === enforcementSource) {
    allowed.push(file);
  } else {
    violations.push(file);
  }
}

for (const file of allowed) process.stdout.write(`Historical terminology reviewed: ${file}\n`);
if (violations.length) {
  process.stderr.write(`Active product terminology violation:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
}
```

The check must reject the old canonical filename, active docs/source matches, and any new occurrence outside the explicit migration/historical rules.

- [ ] **Step 3: Wire the check into `pnpm check`**

```json
{
  "scripts": {
    "check": "pnpm format:check && pnpm naming:check && pnpm terminology:check && pnpm migration:check && pnpm commit:check && pnpm architecture:check && pnpm readiness:check && pnpm lint && pnpm typecheck && pnpm test && pnpm -r build"
  }
}
```

- [ ] **Step 4: Verify terminology and repository structure**

```powershell
pnpm terminology:check
pnpm naming:check
git diff --check
```

Expected: all pass and allowed historical matches are reported, not hidden.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/verify-product-terminology.mjs docs
git commit -m "chore(repo): enforce product terminology"
```

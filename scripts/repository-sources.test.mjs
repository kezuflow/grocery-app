import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { repositorySources } from "./repository-sources.mjs";
import { verifyRepository } from "./verify-architecture-boundaries.mjs";
import { verifySecuritySources } from "./verify-readiness-security.mjs";

function fixture(t) {
  const parent = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(parent, "freshmarkets-harness-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith("freshmarkets-harness-"));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  const write = (name, source) => {
    const destination = path.join(root, name);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  return { root, git, write };
}

test("architecture rejects an untracked Web-to-Core import before staging", (t) => {
  const { root, write } = fixture(t);
  write("apps/web/lib/new-query.ts", 'import { query } from "../../core/src/orders/query";');
  assert.deepEqual(
    verifyRepository(root).map(({ file, code }) => ({ file, code })),
    [{ file: "apps/web/lib/new-query.ts", code: "WEB_IMPORTS_CORE" }],
  );
  write("apps/web/lib/new-query.ts", 'import type { OrderView } from "@freshmarkets/contracts";');
  assert.deepEqual(verifyRepository(root), []);
});

test("security rejects untracked telemetry and reads unstaged edits to tracked files", (t) => {
  const { root, git, write } = fixture(t);
  write("apps/core/src/new-command.ts", 'console.log("unsafe");');
  assert.equal(verifySecuritySources(root)[0]?.code, "DIRECT_CONSOLE");
  write("apps/core/src/new-command.ts", "export const result = 1;");
  git("add", "apps/core/src/new-command.ts");
  assert.deepEqual(verifySecuritySources(root), []);
  write("apps/core/src/new-command.ts", 'console.log("unstaged change");');
  assert.equal(verifySecuritySources(root)[0]?.code, "DIRECT_CONSOLE");
});

test("source discovery respects ignores, deletions, scope, declarations, and literal names", (t) => {
  const { root, git, write } = fixture(t);
  const tracked = "apps/core/src/tracked.ts";
  write(tracked, "export {};");
  write("apps/core/src/deleted.ts", "export {};");
  git("add", "apps");
  rmSync(path.join(root, "apps/core/src/deleted.ts"));
  write(".gitignore", "ignored/\ntracked.ts\n");
  write("apps/core/src/ignored/generated.ts", 'console.log("ignored");');
  write("apps/core/src/types.d.ts", "export {};");
  write("apps/core/src/types.d.mts", "export {};");
  write("apps/core/src/readme.md", "Text");
  const literal = "apps/core/src/space ñ.ts";
  write(literal, "export {};");
  write("packages/contracts/src/new.ts", "export {};");
  assert.deepEqual(repositorySources(root, ["apps/core/src"]), [literal, tracked]);
  assert.deepEqual(verifySecuritySources(root), []);
});

test("source discovery fails instead of reporting success without a Git repository", (t) => {
  const { root } = fixture(t);
  // Remove only the known fixture's Git directory; no user checkout is touched.
  const metadata = path.resolve(root, ".git");
  assert.equal(path.dirname(metadata), root);
  rmSync(metadata, { recursive: true, force: true });
  assert.throws(() => repositorySources(root, ["apps"]));
});

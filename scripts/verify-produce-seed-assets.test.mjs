import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("migration verifier permits extra images but rejects missing seed image references", () => {
  const root = mkdtempSync(join(tmpdir(), "freshmarkets-seed-assets-"));
  try {
    const migrations = join(root, "apps", "core", "migrations");
    const assets = join(root, "apps", "web", "public", "produce");
    cpSync("apps/core/migrations", migrations, { recursive: true });
    mkdirSync(assets, { recursive: true });
    for (const name of readdirSync("apps/web/public/produce").filter((name) =>
      name.endsWith(".webp"),
    )) {
      writeFileSync(join(assets, name), "");
    }
    writeFileSync(join(assets, "unreferenced-fixture.webp"), "");
    const script = resolve("scripts/verify-migrations.mjs");
    const extra = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(extra.status, 0, extra.stderr);
    assert.match(extra.stdout, /Migrations verified/);

    unlinkSync(join(assets, "potato.webp"));
    const missing = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /seed product references missing public asset potato.webp/);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "freshmarkets-seed-assets-")));
    rmSync(root, { recursive: true, force: true });
  }
});

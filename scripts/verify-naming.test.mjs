import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("./verify-naming.mjs", import.meta.url));

test("ignores generated test results and linked worktree metadata", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "freshmarkets-naming-"));
  try {
    await writeFile(join(fixtureRoot, "package.json"), '{"name":"freshmarkets","private":true}');
    await mkdir(join(fixtureRoot, "apps", "web", "test-results", "Generated Result"), {
      recursive: true,
    });
    await mkdir(join(fixtureRoot, ".worktrees", "linked"), { recursive: true });
    await writeFile(
      join(fixtureRoot, ".worktrees", "linked", "package.json"),
      '{"name":"freshmarkets","private":true}',
    );

    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot,
      encoding: "utf8",
      shell: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

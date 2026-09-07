import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

test("E2E setup isolates the selected directory and rejects unsafe names", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "freshmarkets-e2e-state-"));
  try {
    const script = resolve(root, "apps/web/tests/prepare-admin-e2e-state.mjs");
    await mkdir(dirname(script), { recursive: true });
    await copyFile(
      new URL("../apps/web/tests/prepare-admin-e2e-state.mjs", import.meta.url),
      script,
    );
    const retained = resolve(root, "apps/core/.wrangler/e2e-state/retained.txt");
    await mkdir(dirname(retained), { recursive: true });
    await writeFile(retained, "preserve");
    const run = (name) =>
      spawnSync(process.execPath, [script], {
        env: { ...process.env, E2E_STATE_NAME: name },
        encoding: "utf8",
      });
    assert.equal(run("e2e-isolated-test").status, 0);
    assert.equal(await readFile(retained, "utf8"), "preserve");
    for (const name of ["../state", "e2e-../state", "e2e-state;echo", "C:\\state"]) {
      const result = run(name);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Invalid E2E_STATE_NAME/);
      assert.equal(await readFile(retained, "utf8"), "preserve");
    }
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

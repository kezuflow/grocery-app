import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { doctor, listenerInfo } from "./doctor.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("reports a real owned listener and then the free port without throwing", async () => {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  const port = server.address().port;
  try {
    const listener = listenerInfo(port);
    assert.equal(listener.pid, process.pid);
    assert.equal(listener.ancestors.includes(process.pid), true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  assert.equal(listenerInfo(port), null);
});

test("doctor rejects a listener unrelated to the manifest owner", async () => {
  await mkdir(join(root, ".wrangler"), { recursive: true });
  const scratch = await mkdtemp(join(root, ".wrangler/verify-doctor-"));
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  const runFile = join(scratch, "run.json");
  try {
    await writeFile(
      runFile,
      JSON.stringify({
        baseURL: `http://localhost:${server.address().port}`,
        stateName: "e2e-verify-abcdef",
        ownerPid: -1,
      }),
    );
    await assert.rejects(doctor(runFile), {
      message: "Listener is not owned by this verification run",
    });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    assert.equal(dirname(resolve(scratch)), resolve(root, ".wrangler"));
    await rm(scratch, { recursive: true, force: true });
  }
});

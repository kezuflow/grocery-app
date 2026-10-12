import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import captureBundle from "./capture-bundle.cjs";

test("captures exactly the bundle bytes received over HTTP without changing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freshmarkets-bundle-"));
  const destination = join(directory, "bundles.jsonl");
  const sourceSha = "1234567890123456789012345678901234567890";
  const server = http.createServer(
    captureBundle(
      (_request, response) => {
        response.setHeader("content-type", "application/javascript");
        response.write("console.log('bananas');\n");
        response.end(Buffer.from("console.log('₱179');\n"));
      },
      { destination, sourceSha },
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/entry.bundle?platform=android`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString(), "console.log('bananas');\nconsole.log('₱179');\n");
    const receipt = JSON.parse((await readFile(destination, "utf8")).trim());
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.bytes, bytes.length);
    assert.equal(receipt.sourceSha, sourceSha);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.platform, "android");
    await fetch(`${origin}/status`);
    assert.equal((await readFile(destination, "utf8")).trim().split("\n").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

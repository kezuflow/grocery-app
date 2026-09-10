/** Owner-authorized, Cloudflare-authenticated catalog seed import; never a public endpoint.
 * Run without flags to inspect staging; --apply publishes only missing seed photos.
 * Existing photos are preserved. Durable intent precedes create-only R2 storage;
 * publication, Product version, audit and frozen receipt commit in one D1 batch.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scope = "catalog.seed.produce-media.v1";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = (db) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");

export async function importPhoto(db, bucket, product, bytes) {
  const metadata = JSON.parse(product.image_metadata_json);
  assert.match(metadata.assetKey, /^[a-z0-9-]+\.webp$/);
  assert.equal(typeof metadata.altText, "string");
  assert(metadata.altText.trim().length > 0 && metadata.altText.length <= 300);
  assert(bytes.length >= 12 && bytes.length <= 5 * 1024 * 1024);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const key = `produce-media-v1:${product.id}`;
  const hash = digest(JSON.stringify({ productId: product.id, metadata, digest: digest(bytes) }));
  const receipt = await db
    .prepare(
      "SELECT request_hash,status,result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(scope, key)
    .first();
  if (receipt) {
    assert.equal(
      receipt.request_hash,
      hash,
      "Seed input changed; do not overwrite an existing intent",
    );
    if (receipt.status === "SUCCEEDED") return JSON.parse(receipt.result_reference);
    assert.equal(receipt.status, "PROCESSING");
  } else {
    const exists = await db
      .prepare("SELECT id FROM product_media WHERE product_id=? AND status='active' LIMIT 1")
      .bind(product.id)
      .first();
    if (exists) return { productId: product.id, skipped: true };
    const id = randomUUID();
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,?,'PROCESSING',?,?)",
        )
        .bind(scope, key, hash, scope, now, now),
      required(db),
      db
        .prepare(
          "INSERT INTO product_media_upload(id,product_id,object_key,command_scope,idempotency_key,request_json,content_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING',?,?)",
        )
        .bind(
          id,
          product.id,
          `products/${product.id}/${id}`,
          scope,
          key,
          JSON.stringify({
            expectedProductVersion: product.version,
            imageMetadata: product.image_metadata_json,
          }),
          digest(bytes),
          now,
          now,
        ),
      required(db),
    ]);
  }
  const upload = await db
    .prepare("SELECT * FROM product_media_upload WHERE command_scope=? AND idempotency_key=?")
    .bind(scope, key)
    .first();
  assert(
    upload && ["PENDING", "UNKNOWN", "STORED"].includes(upload.status),
    "Upload is not resumable",
  );
  assert.equal(upload.content_digest, digest(bytes));
  const intent = JSON.parse(upload.request_json);
  // Exact input/version guard also protects against changes while bytes are in flight.
  assert.equal(intent.imageMetadata, product.image_metadata_json);
  let object = await bucket.head(upload.object_key);
  if (!object) {
    // Mark uncertainty before put; a lost response must be observed at this same key.
    const changed = await db
      .prepare(
        "UPDATE product_media_upload SET status='UNKNOWN',updated_at=? WHERE id=? AND status IN ('PENDING','UNKNOWN','STORED')",
      )
      .bind(Date.now(), upload.id)
      .run();
    assert.equal(changed.meta.changes, 1);
    await bucket.put(upload.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: upload.content_digest,
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { contentDigest: upload.content_digest },
    });
    object = await bucket.head(upload.object_key);
  }
  assert(object, "R2 upload is unconfirmed; rerun the same import");
  assert.equal(object.size, bytes.length);
  assert.equal(object.customMetadata?.contentDigest, upload.content_digest);
  const stored = await db
    .prepare(
      "UPDATE product_media_upload SET status='STORED',updated_at=? WHERE id=? AND status IN ('PENDING','UNKNOWN','STORED')",
    )
    .bind(Date.now(), upload.id)
    .run();
  assert.equal(stored.meta.changes, 1);
  const value = {
    productId: product.id,
    mediaId: upload.id,
    version: 1,
    src: `/media/products/${upload.id}/1`,
    contentDigest: upload.content_digest,
  };
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM product WHERE id=? AND version=? AND image_metadata_json=? AND status='active') OR EXISTS (SELECT 1 FROM product_media WHERE product_id=? AND status='active')",
      )
      .bind(product.id, intent.expectedProductVersion, intent.imageMetadata, product.id),
    db
      .prepare("UPDATE product SET version=version+1,updated_at=? WHERE id=? AND version=?")
      .bind(now, product.id, intent.expectedProductVersion),
    required(db),
    db
      .prepare(
        "INSERT INTO product_media(id,product_id,object_key,mime_type,byte_size,alt_text,is_primary,sort_order,status,version,created_at,updated_at,content_digest) VALUES (?,?,?,'image/webp',?,?,1,0,'active',1,?,?,?)",
      )
      .bind(
        upload.id,
        product.id,
        upload.object_key,
        bytes.length,
        metadata.altText.trim(),
        now,
        now,
        upload.content_digest,
      ),
    required(db),
    db
      .prepare(
        "UPDATE product_media_upload SET status='ATTACHED',version=version+1,updated_at=? WHERE id=? AND status='STORED'",
      )
      .bind(now, upload.id),
    required(db),
    db
      .prepare(
        "INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,after_json,reason,correlation_id,occurred_at) VALUES (?,NULL,'CATALOG.PRODUCE_MEDIA_IMPORTED','product_media',?,?,?,?,?,?,?)",
      )
      .bind(
        randomUUID(),
        upload.id,
        JSON.stringify({ productId: product.id, assetKey: metadata.assetKey }),
        key,
        JSON.stringify(value),
        "Owner-authorized catalog seed media import using Cloudflare operator credentials",
        key,
        now,
      ),
    required(db),
    db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(value), now, scope, key, hash),
    required(db),
  ]);
  return value;
}

async function main() {
  assert(
    process.argv.slice(2).every((arg) => ["--apply", "--verify", "--first"].includes(arg)),
    "Unknown option",
  );
  const { getPlatformProxy, unstable_readConfig } = await import("wrangler");
  const core = fileURLToPath(new URL("..", import.meta.url));
  const config = unstable_readConfig({ config: join(core, "wrangler.jsonc"), env: "staging" });
  const database = config.d1_databases.find((entry) => entry.binding === "DB");
  const bucket = config.r2_buckets.find((entry) => entry.binding === "PRODUCT_MEDIA");
  assert.equal(database?.database_name, "freshmarkets-core-staging");
  assert.equal(database.database_id, "48aaa957-2be1-4883-9998-5321a49d2825");
  assert.equal(bucket?.bucket_name, "freshmarkets-product-media-staging");
  const directory = await mkdtemp(join(tmpdir(), "freshmarkets-media-"));
  let proxy;
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "freshmarkets-media-import",
        compatibility_date: "2026-09-10",
        account_id: "120b2ec8b5b4a99351d860d22cf51243",
        d1_databases: [{ ...database, remote: true }],
        r2_buckets: [{ ...bucket, remote: true }],
      }),
    );
    proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: true });
    const db = proxy.env.DB;
    const rows = await db
      .prepare(
        "SELECT id,slug,name,version,image_metadata_json FROM product WHERE status='active' ORDER BY slug",
      )
      .all();
    const planned = [];
    for (const product of rows.results) {
      if (!product.image_metadata_json) continue;
      const metadata = JSON.parse(product.image_metadata_json);
      assert.match(metadata.assetKey, /^[a-z0-9-]+\.webp$/);
      const bytes = await readFile(join(core, "../web/public/produce", metadata.assetKey));
      planned.push({ product, bytes });
    }
    assert.equal(planned.length, 226, "Catalog changed; review the import scope");
    console.log(
      JSON.stringify({
        target: database.database_name,
        matchingImages: planned.length,
        apply: process.argv.includes("--apply"),
      }),
    );
    if (process.argv.includes("--apply")) {
      const pending = (process.argv.includes("--first") ? planned.slice(0, 1) : planned).values();
      let completed = 0;
      let failure;
      // Independent products may overlap network I/O; each publication remains atomic.
      // Await every in-flight operation before disposing the proxy after any failure.
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (!failure) {
            const next = pending.next();
            if (next.done) return;
            const { product, bytes } = next.value;
            try {
              const result = await importPhoto(db, proxy.env.PRODUCT_MEDIA, product, bytes);
              console.log(
                JSON.stringify({
                  completed: ++completed,
                  slug: product.slug,
                  skipped: result.skipped ?? false,
                }),
              );
            } catch (error) {
              failure = error;
              console.error(JSON.stringify({ stoppedAt: product.slug }));
            }
          }
        }),
      );
      if (failure) throw failure;
    }
    if (process.argv.includes("--verify")) {
      const verifying = process.argv.includes("--first") ? planned.slice(0, 1) : planned;
      for (const [index, { product, bytes }] of verifying.entries()) {
        const media = await db
          .prepare(
            "SELECT id,version,content_digest FROM product_media WHERE product_id=? AND status='active' AND is_primary=1",
          )
          .bind(product.id)
          .first();
        assert(media, `No primary image: ${product.slug}`);
        const response = await fetch(
          `https://freshmarkets.ph/media/products/${media.id}/${media.version}`,
        );
        assert.equal(response.status, 200, product.slug);
        assert.equal(response.headers.get("content-type"), "image/webp", product.slug);
        assert.equal(
          digest(Buffer.from(await response.arrayBuffer())),
          digest(bytes),
          product.slug,
        );
        if ((index + 1) % 25 === 0) console.log(JSON.stringify({ verified: index + 1 }));
      }
      console.log(JSON.stringify({ verified: verifying.length, byteIdentical: true }));
    }
  } finally {
    if (proxy) await proxy.dispose();
    // Only our newly-created temporary config, never account credentials or application data.
    await rm(join(directory, "wrangler.json"), { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Do not dump Wrangler proxy errors, which may contain bearer endpoints.
    console.error(
      `Produce media import stopped: ${error.name}. Inspect current progress before rerunning.`,
    );
    process.exitCode = 1;
  });
}

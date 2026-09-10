import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { importPhoto } from "../apps/core/scripts/import-produce-media.mjs";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  const directory = new URL("../apps/core/migrations/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    try {
      sql.exec(`BEGIN;\n${readFileSync(new URL(name, directory), "utf8")}\nCOMMIT;`);
    } catch (error) {
      throw new Error(`Migration ${name} failed`, { cause: error });
    }
  }
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const objects = new Map();
  let writes = 0;
  const bucket = {
    async head(key) {
      return objects.get(key) ?? null;
    },
    async put(key, bytes, options) {
      assert.equal(options.onlyIf.etagDoesNotMatch, "*");
      if (objects.has(key)) return null;
      writes++;
      const object = { size: bytes.length, customMetadata: options.customMetadata };
      objects.set(key, object);
      return object;
    },
  };
  const product = sql.prepare("SELECT * FROM product WHERE slug='abiu'").get();
  const bytes = readFileSync(new URL("../apps/web/public/produce/abiu.webp", import.meta.url));
  return { sql, db, bucket, product, bytes, writes: () => writes };
}

test("imports media with audit/receipt and replays without another object or Product version change", async () => {
  const f = fixture();
  try {
    const result = await importPhoto(f.db, f.bucket, f.product, f.bytes);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM product_media").get().n, 1);
    assert.equal(
      f.sql
        .prepare("SELECT count(*) n FROM audit_event WHERE action='CATALOG.PRODUCE_MEDIA_IMPORTED'")
        .get().n,
      1,
    );
    assert.equal(f.sql.prepare("SELECT status FROM product_media_upload").get().status, "ATTACHED");
    assert.equal(
      f.sql.prepare("SELECT version FROM product WHERE id=?").get(f.product.id).version,
      f.product.version + 1,
    );
    assert.deepEqual(await importPhoto(f.db, f.bucket, f.product, f.bytes), result);
    assert.equal(f.writes(), 1);
  } finally {
    f.sql.close();
  }
});

test("lost R2 response resumes the same object, without publishing before confirmation", async () => {
  const f = fixture();
  try {
    const put = f.bucket.put;
    f.bucket.put = async (...args) => {
      await put(...args);
      throw new Error("lost response");
    };
    await assert.rejects(importPhoto(f.db, f.bucket, f.product, f.bytes), /lost response/);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM product_media").get().n, 0);
    f.bucket.put = put;
    await importPhoto(f.db, f.bucket, f.product, f.bytes);
    assert.equal(f.writes(), 1);
  } finally {
    f.sql.close();
  }
});

test("concurrent product edit rolls back the complete publication write set", async () => {
  const f = fixture();
  try {
    const put = f.bucket.put;
    f.bucket.put = async (...args) => {
      const result = await put(...args);
      f.sql.prepare("UPDATE product SET version=version+1 WHERE id=?").run(f.product.id);
      return result;
    };
    await assert.rejects(importPhoto(f.db, f.bucket, f.product, f.bytes));
    assert.equal(f.sql.prepare("SELECT count(*) n FROM product_media").get().n, 0);
    assert.equal(
      f.sql
        .prepare("SELECT count(*) n FROM audit_event WHERE action='CATALOG.PRODUCE_MEDIA_IMPORTED'")
        .get().n,
      0,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT status FROM idempotency_records WHERE scope='catalog.seed.produce-media.v1'",
        )
        .get().status,
      "PROCESSING",
    );
    assert.equal(f.sql.prepare("SELECT status FROM product_media_upload").get().status, "STORED");
  } finally {
    f.sql.close();
  }
});

test("existing admin images are preserved without creating an import intent", async () => {
  const f = fixture();
  try {
    f.sql
      .prepare(
        "INSERT INTO product_media(id,product_id,object_key,mime_type,byte_size,alt_text,is_primary,sort_order,status,version,created_at,updated_at) VALUES ('existing',?,'existing','image/webp',12,'Existing',1,0,'active',1,0,0)",
      )
      .run(f.product.id);
    assert.equal((await importPhoto(f.db, f.bucket, f.product, f.bytes)).skipped, true);
    assert.equal(f.writes(), 0);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM product_media_upload").get().n, 0);
  } finally {
    f.sql.close();
  }
});

test("audit failure rolls back metadata, product version and success receipt together", async () => {
  const f = fixture();
  try {
    f.sql.exec(
      "CREATE TRIGGER fail_import_audit BEFORE INSERT ON audit_event WHEN NEW.action='CATALOG.PRODUCE_MEDIA_IMPORTED' BEGIN SELECT RAISE(ABORT,'test audit failure'); END",
    );
    await assert.rejects(importPhoto(f.db, f.bucket, f.product, f.bytes), /test audit failure/);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM product_media").get().n, 0);
    assert.equal(
      f.sql.prepare("SELECT version FROM product WHERE id=?").get(f.product.id).version,
      f.product.version,
    );
    assert.equal(f.sql.prepare("SELECT status FROM product_media_upload").get().status, "STORED");
    assert.equal(
      f.sql
        .prepare(
          "SELECT status FROM idempotency_records WHERE scope='catalog.seed.produce-media.v1'",
        )
        .get().status,
      "PROCESSING",
    );
  } finally {
    f.sql.close();
  }
});

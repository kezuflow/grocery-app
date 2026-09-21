import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { unstable_readConfig, unstable_getVarsForDev } = require("wrangler");

test("production uses isolated resources and requires live payment bindings", () => {
  const core = unstable_readConfig({
    config: resolve("apps/core/wrangler.jsonc"),
    env: "production",
  });
  const web = unstable_readConfig({
    config: resolve("apps/web/wrangler.jsonc"),
    env: "production",
  });

  assert.equal(core.name, "freshmarkets-core-production");
  assert.deepEqual(core.d1_databases, [
    {
      binding: "DB",
      database_name: "freshmarkets-core-production",
      migrations_dir: "migrations",
    },
  ]);
  assert.equal(core.r2_buckets[0]?.bucket_name, "freshmarkets-product-media-production");
  assert.equal(core.queues.producers[0]?.queue, "freshmarkets-notifications-production");
  assert.equal(
    core.queues.consumers[0]?.dead_letter_queue,
    "freshmarkets-notifications-dlq-production",
  );
  assert.equal(core.vars.PAYMENT_PROVIDER, "paymongo");
  assert.ok(core.secrets.required.includes("PAYMONGO_SECRET_KEY"));
  assert.ok(core.secrets.required.includes("PAYMONGO_WEBHOOK_SECRET"));

  assert.equal(web.name, "freshmarkets-web-production");
  assert.equal(web.services[0]?.service, "freshmarkets-core-production");
  assert.equal(web.vars.ENVIRONMENT, "production");
  assert.ok(web.secrets.required.includes("PAYMONGO_PUBLIC_KEY"));
  assert.deepEqual(web.routes ?? [], []);
});

test("local and staging admit PayMongo bindings only through declared secrets", () => {
  for (const env of [undefined, "staging"]) {
    const core = unstable_readConfig({ config: resolve("apps/core/wrangler.jsonc"), env });
    const web = unstable_readConfig({ config: resolve("apps/web/wrangler.jsonc"), env });

    assert.ok(core.secrets.required.includes("PAYMONGO_SECRET_KEY"));
    assert.ok(core.secrets.required.includes("PAYMONGO_WEBHOOK_SECRET"));
    assert.ok(web.secrets.required.includes("PAYMONGO_PUBLIC_KEY"));
    assert.equal(web.vars.PAYMONGO_PUBLIC_KEY, undefined);
  }
});

for (const env of [undefined, "staging", "production"]) {
  test(`Core ${env ?? "local"} uses the approved delivery defaults and secret boundary`, () => {
    const config = unstable_readConfig({ config: resolve("apps/core/wrangler.jsonc"), env });
    assert.equal(config.vars.DELIVERY_PROVIDERS, env === "staging" ? "lalamove" : "disabled");
    assert.equal(config.vars.LALAMOVE_SERVICE_TYPE, env === "staging" ? "MOTORCYCLE" : "");
    const directory = mkdtempSync(join(tmpdir(), "freshmarkets-delivery-bindings-"));
    const file = join(directory, ".dev.vars");
    const values = {
      DELIVERY_PROVIDERS: "lalamove",
      LALAMOVE_SERVICE_TYPE: "MOTORCYCLE",
      LALAMOVE_MARKET: "PH",
      LALAMOVE_LANGUAGE: "en_PH",
      LALAMOVE_API_KEY: "synthetic-key",
      LALAMOVE_API_SECRET: "synthetic-secret",
    };
    try {
      writeFileSync(
        file,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );
      const bindings = unstable_getVarsForDev(
        join(directory, "wrangler.jsonc"),
        undefined,
        config.vars,
        undefined,
        true,
        config.secrets,
      );
      for (const [key, value] of Object.entries(values)) {
        const productionProviderSecret =
          env === "production" && (key === "LALAMOVE_API_KEY" || key === "LALAMOVE_API_SECRET");
        assert.equal(
          bindings[key]?.value,
          productionProviderSecret ? undefined : value,
          productionProviderSecret
            ? `${key} must remain excluded while production delivery is disabled`
            : `${key} must reach Core`,
        );
      }
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
}

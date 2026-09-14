import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { unstable_readConfig, unstable_getVarsForDev } = require("wrangler");

for (const env of [undefined, "staging"]) {
  test(`Core ${env ?? "local"} uses the approved delivery defaults and admits secret overrides`, () => {
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
      for (const [key, value] of Object.entries(values))
        assert.equal(bindings[key]?.value, value, `${key} must reach Core`);
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
}

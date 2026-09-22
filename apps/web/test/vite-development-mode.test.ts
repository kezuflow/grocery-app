import { describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";
import { configureCoreDevelopmentBindings, resolveDevelopmentDataMode } from "../dev-data-mode";

describe("Vite development data mode", () => {
  it("keeps ordinary serve and explicit local mode isolated", () => {
    expect(resolveDevelopmentDataMode("serve", {})).toBe("local");
    expect(resolveDevelopmentDataMode("serve", { FRESHMARKETS_DEV_DATA: "local" })).toBe("local");
  });

  it("requires the exact shared-staging opt-in", () => {
    expect(resolveDevelopmentDataMode("serve", { FRESHMARKETS_DEV_DATA: "shared-staging" })).toBe(
      "shared-staging",
    );
    expect(() => resolveDevelopmentDataMode("serve", { FRESHMARKETS_DEV_DATA: "staging" })).toThrow(
      /Unsupported FRESHMARKETS_DEV_DATA/,
    );
  });

  it("does not override builds or an explicitly selected Cloudflare environment", () => {
    expect(resolveDevelopmentDataMode("build", { FRESHMARKETS_DEV_DATA: "shared-staging" })).toBe(
      "local",
    );
    expect(
      resolveDevelopmentDataMode("serve", {
        CLOUDFLARE_ENV: "staging",
        FRESHMARKETS_DEV_DATA: "shared-staging",
      }),
    ).toBe("local");
  });

  it("keeps default bindings local and removes direct Email access", () => {
    const local = unstable_readConfig({ config: "../core/wrangler.jsonc" });
    configureCoreDevelopmentBindings(local, undefined);
    expect(local.d1_databases).toMatchObject([
      { binding: "DB", database_name: "freshmarkets-core-dev" },
    ]);
    expect(
      local.d1_databases.every((binding: { remote?: boolean }) => binding.remote !== true),
    ).toBe(true);
    expect(local.r2_buckets).toMatchObject([
      { binding: "PRODUCT_MEDIA", bucket_name: "freshmarkets-product-media-dev" },
    ]);
    expect(local.r2_buckets.every((binding: { remote?: boolean }) => binding.remote !== true)).toBe(
      true,
    );
    expect(local.send_email).toEqual([]);
  });

  it("uses only explicit remote data bindings with provider effects disabled", () => {
    const local = unstable_readConfig({ config: "../core/wrangler.jsonc" });
    const staging = unstable_readConfig({ config: "../core/wrangler.jsonc", env: "staging" });
    configureCoreDevelopmentBindings(local, staging);
    expect(local.d1_databases).toMatchObject([
      { binding: "DB", database_name: "freshmarkets-core-staging", remote: true },
    ]);
    expect(local.r2_buckets).toMatchObject([
      {
        binding: "PRODUCT_MEDIA",
        bucket_name: "freshmarkets-product-media-staging",
        remote: true,
      },
    ]);
    expect(local.send_email).toEqual([]);
    expect(local.queues).toEqual({ producers: [], consumers: [] });
    expect(local.triggers).toEqual({ crons: [] });
    expect(local.vars).toMatchObject({
      PAYMENT_PROVIDER: "disabled",
      DELIVERY_PROVIDER: "disabled",
      DELIVERY_PROVIDERS: "disabled",
    });
  });
});

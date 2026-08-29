import { describe, expect, it } from "vitest";
import { selectCatalogSchemaMigrations } from "./catalog-schema-boundary";

describe("selectCatalogSchemaMigrations", () => {
  it("applies only migrations before the generated catalog migration", () => {
    expect(
      selectCatalogSchemaMigrations(
        [
          "0045_cart_and_inbox_reliability.sql",
          "0025_complete_produce_catalog.sql",
          "0004_phase3_catalog.sql",
          "0024_catalog_details_and_sku_availability.sql",
          "README.md",
        ],
        "0025_complete_produce_catalog.sql",
      ),
    ).toEqual(["0004_phase3_catalog.sql", "0024_catalog_details_and_sku_availability.sql"]);
  });
});

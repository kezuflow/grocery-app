import { describe, expect, it } from "vitest";
import {
  generateProduceCatalogSql,
  LOCATION_CEBU_CENTRAL,
  MARKET_METRO_CEBU,
} from "./generate-produce-catalog-sql.ts";
import type { ProduceSeedProduct } from "./produce-catalog-types.ts";

function manifest(): ProduceSeedProduct[] {
  return [
    {
      id: "product-papaya",
      slug: "papaya",
      name: "Solo Papaya",
      categoryCode: "FRUITS",
      description: "Sweet orange-fleshed papaya.",
      media: { assetKey: "papaya-solo.webp", altText: "Solo papaya" },
      details: [
        { label: "Contents", value: "Sold whole by piece.", sortOrder: 1 },
        { label: "Storage", value: "Ripen at room temperature.", sortOrder: 2 },
      ],
      inventoryBaseUnit: "PIECE",
      variants: [
        {
          id: "sku-papaya-1pc",
          code: "PAPAYA_1PC",
          displayName: "1 piece",
          baseUnit: "PIECE",
          sellUnitCode: "PC",
          sellQuantity: 1,
          inventoryQuantityBase: 1,
          priceMinor: 9500,
          sortOrder: 1,
        },
      ],
    },
    {
      id: "product-chili-pepper-fruit-siling-labuyo",
      slug: "chili-pepper-fruit-siling-labuyo",
      name: "Siling Labuyo",
      categoryCode: "AROMATICS_SPICES",
      description: "Fresh local chilies with Aling Nena's market favorite heat.",
      media: {
        assetKey: "chili-pepper-fruit-siling-labuyo.webp",
        altText: "Siling labuyo peppers",
      },
      details: [
        { label: "Contents", value: "One assembled pack.", sortOrder: 1 },
        { label: "Storage", value: "Keep refrigerated.", sortOrder: 2 },
      ],
      inventoryBaseUnit: "GRAM",
      variants: [
        {
          id: "sku-chili-pepper-fruit-siling-labuyo-pack",
          code: "CHILI_PEPPER_FRUIT_SILING_LABUYO_PACK",
          displayName: "1 pack",
          merchandisingLabel: "Pack",
          customerContentsNote: "Approximately 10–15 chili peppers per pack.",
          packingInstruction: "Pack 100 g per bag.",
          baseUnit: "GRAM",
          sellUnitCode: "G",
          sellQuantity: 100,
          inventoryQuantityBase: 100,
          priceMinor: 6500,
          sortOrder: 1,
        },
      ],
    },
  ];
}

const OPTIONS = {
  existingProductIds: new Set(["product-papaya"]),
  existingSkuIds: new Set(["sku-papaya-250g", "sku-papaya-500g", "sku-papaya-1kg"]),
};

describe("generateProduceCatalogSql", () => {
  it("produces byte-identical output regardless of caller order", () => {
    const ordered = generateProduceCatalogSql(manifest(), OPTIONS);
    const shuffled = generateProduceCatalogSql([...manifest()].reverse(), OPTIONS);
    expect(shuffled).toBe(ordered);
    expect(ordered.length).toBeGreaterThan(1000);
  });

  it("escapes apostrophes into SQL-safe doubled quotes", () => {
    const sql = generateProduceCatalogSql(manifest(), OPTIONS);
    expect(sql).toContain("Aling Nena''s");
    expect(sql).not.toContain("Nena's");
  });

  it("closes v1 prices for reused SKUs and writes version 2, new SKUs start at version 1", () => {
    const sql = generateProduceCatalogSql(manifest(), OPTIONS);
    // Reused product keeps identity but its retired gram SKUs are deactivated.
    expect(sql).toContain(
      "UPDATE sku SET status = 'inactive', updated_at = 0 WHERE id IN ('sku-papaya-1kg','sku-papaya-250g','sku-papaya-500g');",
    );
    const newSkuPrice = sql
      .split("\n")
      .find((line) => line.includes("'price-papaya-1pc-v1'") && line.includes("'sku-papaya-1pc'"));
    expect(newSkuPrice).toBeTruthy();
    expect(newSkuPrice).toContain("9500");
    const chiliPriceLine = sql
      .split("\n")
      .find(
        (line) =>
          line.includes("'sku-chili-pepper-fruit-siling-labuyo-pack', 'PHP'") &&
          line.includes(", 1, 0);"),
      );
    expect(chiliPriceLine).toBeTruthy();
    expect(
      sql
        .split("\n")
        .find(
          (l) => l.includes("'sku-chili-pepper-fruit-siling-labuyo-pack'") && l.includes(", 2,"),
        ),
    ).toBeUndefined();
  });

  it("keeps unit-pack out and confines packing instructions to OPERATIONS rows", () => {
    const sql = generateProduceCatalogSql(manifest(), OPTIONS);
    expect(sql).not.toContain("unit-pack");
    expect(sql).not.toContain("PACK`");
    const opsLines = sql.split("\n").filter((line) => line.includes("'OPERATIONS'"));
    expect(opsLines.length).toBeGreaterThan(0);
    for (const instruction of ["Pack 100 g per bag."]) {
      const holders = sql.split("\n").filter((line) => line.includes(`'${instruction}'`));
      expect(holders.length).toBe(1);
      expect(holders[0]).toContain("'OPERATIONS'");
    }
    expect(
      sql
        .split("\n")
        .some(
          (line) =>
            line.includes("'CUSTOMER'") && line.includes("Approximately 10–15 chili peppers"),
        ),
    ).toBe(true);
  });

  it("reconciles the launch taxonomy and grants Cebu availability and prices", () => {
    const sql = generateProduceCatalogSql(manifest(), OPTIONS);
    expect(sql).toContain("UPDATE category SET code = 'FRUITS'");
    expect(sql).toContain(
      "INSERT OR IGNORE INTO category (id, code, name, slug, status, sort_order, created_at, updated_at)",
    );
    expect(sql).toContain(
      `VALUES ('${LOCATION_CEBU_CENTRAL}', 'product-papaya', 'AVAILABLE', 'PLANNED_PROCUREMENT', 0);`,
    );
    expect(sql).toContain(
      `VALUES ('${LOCATION_CEBU_CENTRAL}', 'product-chili-pepper-fruit-siling-labuyo', 'AVAILABLE', 'PLANNED_PROCUREMENT', 0);`,
    );
    expect(sql).not.toContain("canonical_sourcing_mode");
    expect(sql).toContain(MARKET_METRO_CEBU);
    const availabilityLines = sql
      .split("\n")
      .filter((line) => line.includes("INTO sku_location_availability"));
    expect(availabilityLines).toHaveLength(2);
  });
});

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { fulfillmentLocation } from "../geography/schema";

export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex("category_code_unique").on(table.code),
    slugUnique: uniqueIndex("category_slug_unique").on(table.slug),
  }),
);

export const unit = sqliteTable(
  "unit",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    dimension: text("dimension", { enum: ["MASS", "COUNT", "VOLUME"] }).notNull(),
    symbol: text("symbol").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ codeUnique: uniqueIndex("unit_code_unique").on(table.code) }),
);

export const inventoryPool = sqliteTable(
  "inventory_pool",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    baseUnitId: text("base_unit_id")
      .notNull()
      .references(() => unit.id, { onDelete: "restrict" }),
    sourcingMode: text("sourcing_mode", {
      enum: ["STOCKED", "PLANNED_PROCUREMENT", "HYBRID"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ productUnique: uniqueIndex("inventory_pool_product_unique").on(table.productId) }),
);

export const product = sqliteTable(
  "product",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    inventoryPoolId: text("inventory_pool_id")
      .notNull()
      .references(() => inventoryPool.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    imageMetadataJson: text("image_metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    slugUnique: uniqueIndex("product_slug_unique").on(table.slug),
    poolUnique: uniqueIndex("product_inventory_pool_unique").on(table.inventoryPoolId),
  }),
);

export const sku = sqliteTable(
  "sku",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sellableUnitId: text("sellable_unit_id")
      .notNull()
      .references(() => unit.id, { onDelete: "restrict" }),
    consumptionBaseQuantity: integer("consumption_base_quantity").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex("sku_code_unique").on(table.code),
    productIndex: index("sku_product_status_idx").on(
      table.productId,
      table.status,
      table.sortOrder,
    ),
  }),
);

export const priceVersion = sqliteTable(
  "price_version",
  {
    id: text("id").primaryKey(),
    skuId: text("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    validFrom: integer("valid_from", { mode: "timestamp_ms" }).notNull(),
    validTo: integer("valid_to", { mode: "timestamp_ms" }),
    version: integer("version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    versionUnique: uniqueIndex("price_version_sku_version_unique").on(table.skuId, table.version),
    activeIndex: index("price_version_active_idx").on(table.skuId, table.validFrom, table.validTo),
  }),
);

export const locationProductAvailability = sqliteTable(
  "location_product_availability",
  {
    locationId: text("location_id")
      .notNull()
      .references(() => fulfillmentLocation.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    availabilityStatus: text("availability_status", {
      enum: ["AVAILABLE", "UNAVAILABLE"],
    }).notNull(),
    sourcingMode: text("sourcing_mode"),
    validFrom: integer("valid_from", { mode: "timestamp_ms" }).notNull(),
    validTo: integer("valid_to", { mode: "timestamp_ms" }),
  },
  (table) => ({
    primary: primaryKey({ columns: [table.locationId, table.productId, table.validFrom] }),
    activeIndex: index("location_product_availability_active_idx").on(
      table.locationId,
      table.productId,
      table.availabilityStatus,
    ),
  }),
);

export const catalogSchema = {
  category,
  unit,
  inventoryPool,
  product,
  sku,
  priceVersion,
  locationProductAvailability,
};

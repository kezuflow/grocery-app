import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const market = sqliteTable(
  "market",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ codeUnique: uniqueIndex("market_code_unique").on(table.code) }),
);

export const fulfillmentLocation = sqliteTable(
  "fulfillment_location",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => market.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", {
      enum: ["FULFILLMENT_CENTER", "SATELLITE", "CROSS_DOCK", "DISPATCH_ONLY", "PICKUP_POINT"],
    }).notNull(),
    addressJson: text("address_json"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex("fulfillment_location_market_code_unique").on(
      table.marketId,
      table.code,
    ),
  }),
);

export const locationCapability = sqliteTable(
  "location_capability",
  {
    locationId: text("location_id")
      .notNull()
      .references(() => fulfillmentLocation.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (table) => ({
    primary: primaryKey({ columns: [table.locationId, table.capability] }),
    capabilityIndex: index("location_capability_enabled_idx").on(table.capability, table.enabled),
  }),
);

export const serviceArea = sqliteTable(
  "service_area",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => market.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    polygonGeoJson: text("polygon_geojson").notNull(),
    polygonVersion: integer("polygon_version").notNull(),
    activeFrom: integer("active_from", { mode: "timestamp_ms" }).notNull(),
    activeTo: integer("active_to", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    versionUnique: uniqueIndex("service_area_market_code_version_unique").on(
      table.marketId,
      table.code,
      table.polygonVersion,
    ),
    activeIndex: index("service_area_active_idx").on(
      table.marketId,
      table.status,
      table.activeFrom,
    ),
  }),
);

export const deliveryZone = sqliteTable(
  "delivery_zone",
  {
    id: text("id").primaryKey(),
    serviceAreaId: text("service_area_id")
      .notNull()
      .references(() => serviceArea.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    polygonGeoJson: text("polygon_geojson").notNull(),
    polygonVersion: integer("polygon_version").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    versionUnique: uniqueIndex("delivery_zone_area_code_version_unique").on(
      table.serviceAreaId,
      table.code,
      table.polygonVersion,
    ),
    activeIndex: index("delivery_zone_active_idx").on(table.serviceAreaId, table.status),
  }),
);

export const locationServiceability = sqliteTable(
  "location_serviceability",
  {
    zoneId: text("zone_id")
      .notNull()
      .references(() => deliveryZone.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => fulfillmentLocation.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    eligible: integer("eligible", { mode: "boolean" }).notNull().default(true),
    validFrom: integer("valid_from", { mode: "timestamp_ms" }).notNull(),
    validTo: integer("valid_to", { mode: "timestamp_ms" }),
  },
  (table) => ({
    primary: primaryKey({ columns: [table.zoneId, table.locationId, table.validFrom] }),
    candidateIndex: index("location_serviceability_candidate_idx").on(
      table.zoneId,
      table.eligible,
      table.priority,
    ),
  }),
);

export const geographySchema = {
  organization,
  market,
  fulfillmentLocation,
  locationCapability,
  serviceArea,
  deliveryZone,
  locationServiceability,
};

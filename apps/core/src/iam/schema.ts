import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { authUser } from "../auth/schema";

// Application-owned identity and access tables. Better Auth owns only
// authentication infrastructure; staff identities, roles, permissions, scopes,
// and customer principals are application domains linked to the auth user ID.
export const staffIdentity = sqliteTable(
  "staff_identity",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ userUnique: uniqueIndex("staff_identity_auth_user_unique").on(table.authUserId) }),
);

export const customerPrincipal = sqliteTable(
  "customer_principal",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userUnique: uniqueIndex("customer_principal_auth_user_unique").on(table.authUserId),
  }),
);

export const role = sqliteTable(
  "role",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ codeUnique: uniqueIndex("role_code_unique").on(table.code) }),
);

export const permission = sqliteTable(
  "permission",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ codeUnique: uniqueIndex("permission_code_unique").on(table.code) }),
);

export const rolePermission = sqliteTable(
  "role_permission",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pairUnique: uniqueIndex("role_permission_pair_unique").on(table.roleId, table.permissionId),
  }),
);

export const staffRole = sqliteTable(
  "staff_role",
  {
    staffId: text("staff_id")
      .notNull()
      .references(() => staffIdentity.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pairUnique: uniqueIndex("staff_role_pair_unique").on(table.staffId, table.roleId),
  }),
);

export const staffScope = sqliteTable(
  "staff_scope",
  {
    id: text("id").primaryKey(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffIdentity.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind", { enum: ["global", "market", "location"] }).notNull(),
    marketId: text("market_id"),
    locationId: text("location_id"),
  },
  (table) => ({
    scopeUnique: uniqueIndex("staff_scope_unique").on(
      table.staffId,
      table.scopeKind,
      table.marketId,
      table.locationId,
    ),
  }),
);

export const iamSchema = {
  staffIdentity,
  customerPrincipal,
  role,
  permission,
  rolePermission,
  staffRole,
  staffScope,
};

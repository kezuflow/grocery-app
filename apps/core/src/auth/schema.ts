import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const authUser = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ emailUnique: uniqueIndex("user_email_unique").on(table.email) }),
);

export const authSession = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => ({ tokenUnique: uniqueIndex("session_token_unique").on(table.token) }),
);

export const authAccount = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    issuerAccountUnique: uniqueIndex("account_issuer_account_id_unique").on(
      table.issuer,
      table.accountId,
    ),
    userIndex: index("account_user_id_idx").on(table.userId),
  }),
);

export const authVerification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

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

export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  staffIdentity,
  customerPrincipal,
  role,
  permission,
  rolePermission,
  staffRole,
  staffScope,
};

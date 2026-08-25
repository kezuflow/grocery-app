import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { betterAuthSchema } from "../auth/schema";
import { createBetterAuthDatabase, type AuthEnvironment } from "../auth/service";
import { iamSchema } from "./schema";

type SchemaBoundDatabase = { _: { fullSchema: Record<string, unknown> } };

describe("auth and iam schema ownership", () => {
  it("keeps better auth tables and application iam tables in separate schemas", () => {
    expect(Object.keys(betterAuthSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
    expect(Object.keys(iamSchema).sort()).toEqual([
      "customerPrincipal",
      "permission",
      "role",
      "rolePermission",
      "staffIdentity",
      "staffRole",
      "staffScope",
    ]);
  });

  it("binds only better auth tables to the database composed for the drizzle adapter", () => {
    const database = createBetterAuthDatabase({ DB: env.DB } satisfies AuthEnvironment) as unknown as SchemaBoundDatabase;
    const fullSchema = database._.fullSchema ?? {};
    expect(Object.keys(fullSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("keeps iam tables out of the better auth bound schema", () => {
    const database = createBetterAuthDatabase({ DB: env.DB } satisfies AuthEnvironment) as unknown as SchemaBoundDatabase;
    const bound = Object.keys(database._.fullSchema ?? {});
    for (const iamTable of Object.keys(iamSchema)) {
      expect(bound).not.toContain(iamTable);
    }
  });
});

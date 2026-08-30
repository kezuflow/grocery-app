import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { resolveServiceFee } from "./resolve-service-fee";

async function install(input: {
  id: string;
  type: "FLAT" | "PERCENTAGE" | "MIXED";
  flat: number;
  basisPoints: number;
  from: number;
  to?: number;
  version: number;
  currency?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO service_fee_configuration (
       id, fee_type, flat_minor, percentage_basis_points, currency,
       effective_from, effective_to, version, reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test configuration', ?)`,
  )
    .bind(
      input.id,
      input.type,
      input.flat,
      input.basisPoints,
      input.currency ?? "PHP",
      input.from,
      input.to ?? null,
      input.version,
      input.from,
    )
    .run();
}

describe("resolveServiceFee", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM service_fee_configuration").run();
  });

  it("resolves exactly one effective configuration", async () => {
    await install({
      id: "fee-v1",
      type: "MIXED",
      flat: 1_500,
      basisPoints: 300,
      from: 100,
      version: 1,
    });

    expect(
      await resolveServiceFee(env.DB, { currency: "PHP", baseMinor: 100_000, at: 200 }),
    ).toEqual({
      ok: true,
      value: {
        configurationId: "fee-v1",
        configurationVersion: 1,
        feeType: "MIXED",
        currency: "PHP",
        flatMinor: 1_500,
        percentageBasisPoints: 300,
        baseMinor: 100_000,
        feeMinor: 4_500,
      },
    });
  });

  it("fails closed when no effective configuration exists", async () => {
    expect(
      await resolveServiceFee(env.DB, { currency: "PHP", baseMinor: 100_000, at: 200 }),
    ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
  });

  it("fails closed when effective ranges overlap", async () => {
    await install({
      id: "fee-overlap-1",
      type: "FLAT",
      flat: 100,
      basisPoints: 0,
      from: 100,
      to: 400,
      version: 1,
    });
    await install({
      id: "fee-overlap-2",
      type: "FLAT",
      flat: 200,
      basisPoints: 0,
      from: 200,
      to: 500,
      version: 2,
    });

    expect(
      await resolveServiceFee(env.DB, { currency: "PHP", baseMinor: 100_000, at: 300 }),
    ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
  });
});

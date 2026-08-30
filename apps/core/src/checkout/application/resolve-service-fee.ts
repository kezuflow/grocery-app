import { calculateServiceFee, type ServiceFeeCalculation } from "../domain/service-fee";

type ServiceFeeConfigurationRow = {
  id: string;
  fee_type: "FLAT" | "PERCENTAGE" | "MIXED";
  flat_minor: number;
  percentage_basis_points: number;
  currency: string;
  version: number;
};

export type ServiceFeeResolution =
  | { ok: true; value: ServiceFeeCalculation }
  | {
      ok: false;
      error: { code: "CONFIGURATION_ERROR"; message: string };
    };

export async function resolveServiceFee(
  database: D1Database,
  input: { currency: string; baseMinor: number; at: number },
): Promise<ServiceFeeResolution> {
  const rows = await database
    .prepare(
      `SELECT id, fee_type, flat_minor, percentage_basis_points, currency, version
       FROM service_fee_configuration
       WHERE currency = ?
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, version DESC
       LIMIT 2`,
    )
    .bind(input.currency, input.at, input.at)
    .all<ServiceFeeConfigurationRow>();

  if (rows.results.length !== 1) {
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message:
          rows.results.length === 0
            ? "FreshMarkets Service Fee configuration is unavailable"
            : "FreshMarkets Service Fee effective ranges overlap",
      },
    };
  }

  const row = rows.results[0]!;
  try {
    return {
      ok: true,
      value: calculateServiceFee({
        configurationId: row.id,
        configurationVersion: row.version,
        feeType: row.fee_type,
        currency: row.currency,
        flatMinor: row.flat_minor,
        basisPoints: row.percentage_basis_points,
        baseMinor: input.baseMinor,
      }),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: "FreshMarkets Service Fee configuration is invalid",
      },
    };
  }
}

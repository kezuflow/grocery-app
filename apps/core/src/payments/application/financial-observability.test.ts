import { describe, expect, it, vi } from "vitest";
import { recordFinancialEvent, validateSettlement } from "./financial-observability";

describe("financial observability", () => {
  it.each([
    {
      name: "processing cost",
      settlement: {
        grossMinor: 100_000,
        processingCostMinor: 4_500,
        withholdingMinor: 0,
        adjustmentMinor: 0,
        netMinor: 95_500,
      },
    },
    {
      name: "withholding and positive adjustment",
      settlement: {
        grossMinor: 100_000,
        processingCostMinor: 4_500,
        withholdingMinor: 500,
        adjustmentMinor: 1_000,
        netMinor: 96_000,
      },
    },
  ])("accepts settlement evidence with exact $name arithmetic", ({ settlement }) => {
    expect(validateSettlement(settlement)).toBe(true);
  });

  it.each([
    {
      name: "mismatched net",
      settlement: {
        grossMinor: 100_000,
        processingCostMinor: 4_500,
        withholdingMinor: 0,
        adjustmentMinor: 0,
        netMinor: 100_000,
      },
    },
    {
      name: "negative component",
      settlement: {
        grossMinor: 100_000,
        processingCostMinor: -1,
        withholdingMinor: 0,
        adjustmentMinor: 0,
        netMinor: 100_001,
      },
    },
    {
      name: "unsafe integer",
      settlement: {
        grossMinor: Number.MAX_SAFE_INTEGER + 1,
        processingCostMinor: 0,
        withholdingMinor: 0,
        adjustmentMinor: 0,
        netMinor: Number.MAX_SAFE_INTEGER + 1,
      },
    },
  ])("rejects $name settlement evidence", ({ settlement }) => {
    expect(validateSettlement(settlement)).toBe(false);
  });

  it("emits only the closed safe financial vocabulary", () => {
    const write = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const output = recordFinancialEvent({
      event: "payment_outcome_unresolved",
      requestId: "request-1",
      scope: "payments.create",
      provider: "mock",
      aggregateId: "intent-1",
      attemptCount: 1,
      outcomeCode: "PAYMENT_OUTCOME_UNRESOLVED",
      durationMs: 25,
    });

    expect(Object.keys(output).sort()).toEqual([
      "aggregateId",
      "attemptCount",
      "durationMs",
      "event",
      "outcomeCode",
      "provider",
      "requestId",
      "scope",
    ]);
    expect(JSON.stringify(output)).not.toMatch(
      /authorization|redirect|token|payload|address|cookie|details/i,
    );
    expect(write).toHaveBeenCalledWith(JSON.stringify(output));
    write.mockRestore();
  });

  it("drops unknown runtime fields instead of forwarding them to logs", () => {
    const write = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const output = recordFinancialEvent({
      event: "provider_observation_replayed",
      scope: "payments.observe",
      aggregateId: "intent-2",
      redirectUrl: "https://secret.invalid",
      clientToken: "secret",
    } as never);

    expect(output).not.toHaveProperty("redirectUrl");
    expect(output).not.toHaveProperty("clientToken");
    write.mockRestore();
  });
});

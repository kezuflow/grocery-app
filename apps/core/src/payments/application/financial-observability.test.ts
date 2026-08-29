import { describe, expect, it, vi } from "vitest";
import { recordFinancialEvent } from "./financial-observability";

describe("financial observability", () => {
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

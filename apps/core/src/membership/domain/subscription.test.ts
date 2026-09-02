import { describe, expect, it } from "vitest";
import {
  canTransitionSubscription,
  findSubscriptionTransitionPath,
  transitionSubscription,
} from "./subscription";

describe("canonical subscription lifecycle", () => {
  it("allows every approved edge in the canonical machine", () => {
    const allowed: Array<[string, string]> = [
      ["PENDING", "TRIALING"],
      ["PENDING", "ACTIVE"],
      ["PENDING", "CANCELED"],
      ["PENDING", "EXPIRED"],
      ["TRIALING", "CANCELED"],
      ["TRIALING", "EXPIRED"],
      ["ACTIVE", "PAST_DUE"],
      ["ACTIVE", "PAUSED"],
      ["ACTIVE", "CANCELED"],
      ["ACTIVE", "EXPIRED"],
      ["PAST_DUE", "ACTIVE"],
      ["PAST_DUE", "PAUSED"],
      ["PAST_DUE", "CANCELED"],
      ["PAST_DUE", "EXPIRED"],
      ["PAUSED", "ACTIVE"],
      ["PAUSED", "CANCELED"],
      ["PAUSED", "EXPIRED"],
    ];
    for (const [from, to] of allowed)
      expect(canTransitionSubscription(from as never, to as never)).toBe(true);
  });

  it("rejects representative illegal edges", () => {
    const illegal: Array<[string, string]> = [
      ["TRIALING", "PAST_DUE"],
      ["TRIALING", "PAUSED"],
      ["TRIALING", "ACTIVE"],
      ["PAST_DUE", "TRIALING"],
      ["PAUSED", "PAST_DUE"],
      ["PAUSED", "TRIALING"],
      ["ACTIVE", "TRIALING"],
      ["PENDING", "PAST_DUE"],
    ];
    for (const [from, to] of illegal) {
      expect(() => transitionSubscription(from as never, to as never)).toThrow(
        "ILLEGAL_TRANSITION",
      );
    }
  });

  it("gives CANCELED and EXPIRED zero outgoing transitions", () => {
    for (const terminal of ["CANCELED", "EXPIRED"] as const) {
      for (const target of [
        "PENDING",
        "TRIALING",
        "ACTIVE",
        "PAST_DUE",
        "PAUSED",
        "CANCELED",
        "EXPIRED",
      ] as const) {
        expect(canTransitionSubscription(terminal, target)).toBe(false);
      }
      expect(() =>
        transitionSubscription(terminal, terminal === "CANCELED" ? "ACTIVE" : "EXPIRED"),
      ).toThrow("ILLEGAL_TRANSITION");
    }
  });

  it("finds catch-up paths only where a legal route exists", () => {
    expect(findSubscriptionTransitionPath("TRIALING", "SUCCEEDED" as never)).toBeNull();
    expect(findSubscriptionTransitionPath("ACTIVE", "ACTIVE")).toEqual([]);
    expect(findSubscriptionTransitionPath("ACTIVE", "PAUSED")).toEqual(["ACTIVE", "PAUSED"]);
  });
});

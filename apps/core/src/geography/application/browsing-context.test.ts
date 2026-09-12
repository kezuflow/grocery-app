import { describe, expect, it } from "vitest";
import { issueBrowsingContext, locationFromBrowsingContext } from "./browsing-context";

const secret = "test-only-browsing-context-secret-at-least-32-characters";
const now = Date.UTC(2026, 8, 13, 0, 0, 0);

describe("signed browsing context", () => {
  it("recovers the location only with the issuing secret and inside its lifetime", async () => {
    const token = await issueBrowsingContext(secret, {
      locationId: "location-cebu-central",
      serviceAreaCode: "CEBU",
      serviceAreaVersion: 3,
      now,
    });
    expect(await locationFromBrowsingContext(secret, token, now + 1)).toBe("location-cebu-central");
    expect(await locationFromBrowsingContext(`${secret}-wrong`, token, now + 1)).toBeNull();
    expect(
      await locationFromBrowsingContext(secret, token, now + 30 * 24 * 60 * 60 * 1000),
    ).toBeNull();
  });

  it("rejects payload and signature tampering without throwing", async () => {
    const token = await issueBrowsingContext(secret, {
      locationId: "location-cebu-central",
      serviceAreaCode: "CEBU",
      serviceAreaVersion: 3,
      now,
    });
    const [payload, signature] = token.split(".");
    expect(
      await locationFromBrowsingContext(secret, `${payload}x.${signature}`, now + 1),
    ).toBeNull();
    expect(
      await locationFromBrowsingContext(secret, `${payload}.${signature}x`, now + 1),
    ).toBeNull();
    expect(await locationFromBrowsingContext(secret, "not-a-token", now + 1)).toBeNull();
  });
});

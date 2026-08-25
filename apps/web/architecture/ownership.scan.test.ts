import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const coreSrc = join(repoRoot, "apps", "core", "src");

describe("architecture ownership content scans (node-side)", () => {
  it("keeps every retired compatibility symbol out of production source", () => {
    const banned = [/commitMockOrder/, /paymentMethodRef/, /CANCELLED/];
    const offenders: string[] = [];
    for (const file of walk(coreSrc)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(content)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("confines provider reference vocabulary to the Payments context", () => {
    const offenders = walk(coreSrc)
      .filter((file) => !file.replace(/\\/g, "/").includes("src/payments/"))
      .filter((file) =>
        /providerCustomerRef|providerSubscriptionRef|provider_customer_ref|provider_subscription_ref/.test(
          readFileSync(file, "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("exposes no raw-row contract in shared DTOs", () => {
    const contractsIndex = readFileSync(
      join(repoRoot, "packages", "contracts", "src", "index.ts"),
      "utf8",
    );
    expect(contractsIndex).not.toMatch(/D1Database|sqliteTable/);
  });
});

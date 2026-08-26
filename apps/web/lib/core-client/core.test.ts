import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type CoreHealthResponse } from "@freshmarkets/contracts";
import { coreClient } from "./core";

function routeFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("checked core binding adapter", () => {
  it("delegates health exactly once and returns the typed response", async () => {
    const healthResponse: CoreHealthResponse = {
      service: "core",
      status: "ok",
      contractVersion: CONTRACT_VERSION,
      environment: "test",
      databaseBindingConfigured: true,
      timestamp: new Date(0).toISOString(),
    };
    const binding = { health: vi.fn(async () => healthResponse) };
    const client = coreClient(binding as unknown as Parameters<typeof coreClient>[0]);
    const result = await client.health({ requestId: "adapter-test" });
    expect(binding.health).toHaveBeenCalledTimes(1);
    expect(result).toEqual(healthResponse);
  });

  it("keeps the binding cast inside the adapter only", () => {
    const apiDir = join(import.meta.dirname, "..", "..", "app", "api");
    const offenders = routeFiles(apiDir).filter((file) =>
      readFileSync(file, "utf8").includes("as unknown as CoreServiceBinding"),
    );
    expect(offenders).toEqual([]);
  });
});

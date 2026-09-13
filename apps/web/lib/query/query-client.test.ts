import { describe, expect, it } from "vitest";
import { createQueryClient, queryKeys } from "./query-client";

describe("application query isolation", () => {
  it("isolates separately rendered applications and authorized scopes", () => {
    const first = createQueryClient();
    const second = createQueryClient();
    const key = queryKeys.admin(0, "location-a", "orders");
    first.setQueryData(key, ["private-record"]);
    expect(second.getQueryData(key)).toBeUndefined();
    expect(first.getQueryData(queryKeys.admin(0, "location-b", "orders"))).toBeUndefined();
    expect(first.getQueryData(queryKeys.admin(1, "location-a", "orders"))).toBeUndefined();
  });

  it("does not restore canceled old-context data when a read ignores abort", async () => {
    const client = createQueryClient();
    let finish: (value: string) => void = () => {};
    const key = queryKeys.private(0, "cart");
    const oldRead = client
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => null);
    await client.cancelQueries();
    client.clear();
    client.setQueryData(queryKeys.private(1, "cart"), "new-cart");
    finish("old-cart");
    await oldRead;
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(queryKeys.private(1, "cart"))).toBe("new-cart");
  });
});

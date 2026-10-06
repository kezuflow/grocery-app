import { expect, test } from "./admin-authenticated-fixture";

test("an authorized location reader opens the operational WebSocket through Web and Core", async ({
  fulfillmentReadOnlyPage: page,
}) => {
  await page.goto("/admin/fulfillment");
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const url = new URL("/api/admin/operational-stream", location.href);
        url.searchParams.set("locationId", "location-cebu-central");
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        const timeout = setTimeout(() => resolve("timeout"), 8_000);
        socket.onopen = () => {
          clearTimeout(timeout);
          socket.close();
          resolve("open");
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          resolve("error");
        };
      }),
  );
  expect(result).toBe("open");
});

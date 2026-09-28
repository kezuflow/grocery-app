import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

it("closes an expired inbox socket before publishing a revision", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T00:00:00.000Z"));
  const hub = env.MESSAGE_HUB.getByName(`expiry-${crypto.randomUUID()}`);
  const connection = await hub.fetch(
    new Request("https://core.example.invalid/socket", {
      headers: {
        upgrade: "websocket",
        "x-message-role": "INBOX",
        "x-message-actor": "test-actor",
      },
    }),
  );
  expect(connection.status).toBe(101);
  const socket = connection.webSocket;
  if (!socket) throw new Error("Expected WebSocket upgrade");
  socket.accept();
  const received: string[] = [];
  socket.addEventListener("message", (event) => {
    received.push(String(event.data));
  });
  const first = new Promise<void>((resolve) =>
    socket.addEventListener("message", () => resolve(), { once: true }),
  );
  await hub.publish(1);
  await first;
  expect(received).toEqual([JSON.stringify({ type: "revision", revision: 1 })]);

  vi.setSystemTime(new Date("2026-09-28T00:16:00.000Z"));
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener("close", () => resolve(), { once: true }),
  );
  await hub.publish(2);
  await closed;
  expect(received).toEqual([JSON.stringify({ type: "revision", revision: 1 })]);
});

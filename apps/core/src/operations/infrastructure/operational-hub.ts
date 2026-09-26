import { DurableObject } from "cloudflare:workers";

/** Ephemeral location fanout. D1 retains the authoritative revision and retry state. */
export class OperationalHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket upgrade required", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(revision: number): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid revision");
    const message = JSON.stringify({ revision });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        try {
          socket.close(1011, "Connection interrupted");
        } catch {
          // One disconnected client cannot block publication to other clients.
        }
      }
    }
  }
}

import { DurableObject } from "cloudflare:workers";

type SocketAttachment = {
  role: "CUSTOMER" | "ADMIN" | "INBOX";
  actorId: string;
  expiresAt: number;
  presenceUntil: number;
  lastTypingAt: number;
};

/** Ephemeral fanout only. D1 owns message revisions and transcript content. */
export class MessageHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket upgrade required", { status: 426 });
    const role = request.headers.get("x-message-role");
    const actorId = request.headers.get("x-message-actor");
    if ((role !== "CUSTOMER" && role !== "ADMIN" && role !== "INBOX") || !actorId)
      return new Response(null, { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    const now = Date.now();
    server.serializeAttachment({
      role,
      actorId,
      expiresAt: now + 15 * 60_000,
      presenceUntil: now + 90_000,
      lastTypingAt: 0,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    if (role !== "INBOX") this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(revision: number): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid revision");
    this.broadcast(JSON.stringify({ type: "revision", revision }));
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return this.close(socket);
    const now = Date.now();
    if (now > attachment.expiresAt) return this.close(socket);
    if (typeof raw !== "string" || raw.length > 128 || attachment.role === "INBOX") return;
    let event: { type?: unknown; active?: unknown };
    try {
      event = JSON.parse(raw) as { type?: unknown; active?: unknown };
    } catch {
      return;
    }
    if (event.type === "heartbeat") {
      socket.serializeAttachment({ ...attachment, presenceUntil: now + 90_000 });
      this.broadcastPresence();
      return;
    }
    if (event.type !== "typing" || typeof event.active !== "boolean") return;
    if (event.active && now - attachment.lastTypingAt < 2500) return;
    socket.serializeAttachment({ ...attachment, lastTypingAt: now, presenceUntil: now + 90_000 });
    const audience = attachment.role === "CUSTOMER" ? "ADMIN" : "CUSTOMER";
    this.broadcast(
      JSON.stringify({
        type: "typing",
        role: attachment.role,
        active: event.active,
        until: event.active ? now + 5_000 : now,
      }),
      audience,
    );
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      /* Already closed. */
    }
    this.broadcastPresence();
  }

  webSocketError(socket: WebSocket): void {
    this.close(socket);
    this.broadcastPresence();
  }

  private close(socket: WebSocket): void {
    try {
      socket.close(1008, "Reconnect required");
    } catch {
      /* Already closed. */
    }
  }

  private broadcastPresence(): void {
    const now = Date.now();
    const present = { CUSTOMER: false, ADMIN: false };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (
        attachment &&
        attachment.role !== "INBOX" &&
        attachment.expiresAt > now &&
        attachment.presenceUntil > now
      )
        present[attachment.role] = true;
    }
    this.broadcast(JSON.stringify({ type: "presence", present, until: now + 90_000 }));
  }

  private broadcast(message: string, audience?: SocketAttachment["role"]): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || attachment.expiresAt <= now) {
        this.close(socket);
        continue;
      }
      if (audience && attachment?.role !== audience) continue;
      try {
        socket.send(message);
      } catch {
        this.close(socket);
      }
    }
  }
}

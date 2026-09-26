import handler from "vinext/server/fetch-handler";

/** WebSocket upgrades bypass vinext's HTTP route-response normalization. */
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    if (
      new URL(request.url).pathname === "/api/admin/operational-stream" &&
      request.method === "GET" &&
      request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      if (request.headers.get("origin") !== new URL(request.url).origin)
        return new Response(null, { status: 403 });
      return env.CORE.fetch(request.url, { method: "GET", headers: request.headers });
    }
    return handler.fetch(request, env, ctx);
  },
};

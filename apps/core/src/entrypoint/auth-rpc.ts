import type { AuthContextRequest, AuthRequest, AuthResponse } from "@freshmarkets/contracts";
import { publicApplicationContext } from "../auth/authorization";
import type { CoreRpcContext } from "./context";

export function createAuthRpc(context: CoreRpcContext) {
  return {
    async auth(input: AuthRequest): Promise<AuthResponse> {
      const request = new Request(input.url, {
        method: input.method,
        headers: new Headers(input.headers),
        body:
          input.body && input.method !== "GET" && input.method !== "HEAD" ? input.body : undefined,
      });
      return serializeAuthResponse(await context.auth.handler(request));
    },

    getApplicationContext(input: AuthContextRequest) {
      return publicApplicationContext(context.auth, context.iamDatabase, input);
    },
  };
}

async function serializeAuthResponse(response: Response): Promise<AuthResponse> {
  const headers: Array<readonly [string, string]> = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers.push([key, value]);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? [])
    headers.push(["set-cookie", cookie]);
  return { status: response.status, headers, body: await response.text() };
}

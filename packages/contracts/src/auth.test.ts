import { describe, expect, it } from "vitest";
import type { AuthRequest, ApplicationContext } from "./index";

describe("auth contracts", () => {
  it("keeps auth transport and application context as DTOs", () => {
    const request: AuthRequest = {
      method: "GET",
      url: "https://web.example/api/auth/get-session",
      headers: { cookie: "" },
    };
    const context: ApplicationContext = {
      authenticated: false,
      principal: null,
      capabilities: [],
      scopes: [],
    };
    expect(request.method).toBe("GET");
    expect(context.authenticated).toBe(false);
  });
});

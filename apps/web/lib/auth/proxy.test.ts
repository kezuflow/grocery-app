import { describe, expect, it, vi } from "vitest";
import type { AuthRequest, AuthResponse } from "@freshmarkets/contracts";
import { proxyAuthRequest, resolvePublicAppOrigin } from "./proxy";

const authResponse: AuthResponse = {
  status: 302,
  headers: [
    ["location", "https://accounts.google.com/oauth/start"],
    ["set-cookie", "session=a; Path=/; HttpOnly; Secure; SameSite=Lax"],
    ["set-cookie", "csrf=b; Path=/; HttpOnly; Secure; SameSite=Lax"],
  ],
  body: "",
};

function coreAuthSpy() {
  return vi.fn(async (_input: AuthRequest): Promise<AuthResponse> => authResponse);
}

describe("proxyAuthRequest", () => {
  it("forwards the configured public origin, never the incoming attacker-controlled origin", async () => {
    const auth = coreAuthSpy();
    const request = new Request("https://freshmarkets.ph/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-origin": "https://attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
      body: "{}",
    });
    await proxyAuthRequest(request, { auth }, "https://freshmarkets.ph");
    const forwarded = auth.mock.calls[0][0].headers;
    expect(forwarded["x-forwarded-origin"]).toBe("https://freshmarkets.ph");
    expect(forwarded["x-forwarded-origin"]).not.toBe("https://attacker.example");
    expect(forwarded["x-forwarded-host"]).toBe("freshmarkets.ph");
    expect(forwarded["x-forwarded-proto"]).toBe("https");
  });

  it("preserves status, location, and every repeated set-cookie header", async () => {
    const auth = coreAuthSpy();
    const request = new Request("https://freshmarkets.ph/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://freshmarkets.ph" },
      body: "",
    });
    const response = await proxyAuthRequest(request, { auth }, "https://freshmarkets.ph");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/oauth/start");
    expect(response.headers.getSetCookie()).toEqual([
      "session=a; Path=/; HttpOnly; Secure; SameSite=Lax",
      "csrf=b; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  it("forwards the request method, url, and body to Core", async () => {
    const auth = coreAuthSpy();
    const request = new Request("https://freshmarkets.ph/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"email":"customer@example.com","password":"correct-horse"}',
    });
    await proxyAuthRequest(request, { auth }, "https://freshmarkets.ph");
    const forwarded = auth.mock.calls[0][0];
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe("https://freshmarkets.ph/api/auth/sign-in/email");
    expect(forwarded.body).toBe('{"email":"customer@example.com","password":"correct-horse"}');
    expect(forwarded.headers["content-type"]).toBe("application/json");
  });

  it("omits the body for GET requests", async () => {
    const auth = coreAuthSpy();
    const request = new Request("https://freshmarkets.ph/api/auth/get-session", { method: "GET" });
    await proxyAuthRequest(request, { auth }, "https://freshmarkets.ph");
    expect(auth.mock.calls[0][0].body).toBeUndefined();
  });
});

describe("resolvePublicAppOrigin", () => {
  it("normalizes the configured public origin", () => {
    expect(resolvePublicAppOrigin("https://freshmarkets.ph")).toBe("https://freshmarkets.ph");
    expect(resolvePublicAppOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("rejects missing, malformed, non-https, and non-origin values", () => {
    expect(() => resolvePublicAppOrigin(undefined)).toThrow("PUBLIC_APP_ORIGIN_REQUIRED");
    expect(() => resolvePublicAppOrigin("not-a-url")).toThrow("PUBLIC_APP_ORIGIN_INVALID");
    expect(() => resolvePublicAppOrigin("http://freshmarkets.ph")).toThrow(
      "PUBLIC_APP_ORIGIN_INVALID",
    );
    expect(() => resolvePublicAppOrigin("https://freshmarkets.ph/app")).toThrow(
      "PUBLIC_APP_ORIGIN_INVALID",
    );
    expect(() => resolvePublicAppOrigin("https://freshmarkets.ph?x=1")).toThrow(
      "PUBLIC_APP_ORIGIN_INVALID",
    );
  });
});

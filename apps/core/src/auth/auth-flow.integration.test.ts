import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createAuth, type AuthEnvironment } from "./service";
import type { AuthEmailMessage } from "./email-delivery";

const baseUrl = "http://localhost:3000";

function authEnvironment(overrides: Partial<AuthEnvironment> = {}): AuthEnvironment {
  return {
    DB: env.DB,
    ENVIRONMENT: "development",
    BETTER_AUTH_SECRET: "integration-test-secret",
    BETTER_AUTH_URL: baseUrl,
    TRUSTED_ORIGINS: baseUrl,
    ...overrides,
  };
}

type Sent = AuthEmailMessage[];

function createAuthWithCapture(sent: Sent, overrides: Partial<AuthEnvironment> = {}) {
  return createAuth(authEnvironment(overrides), {
    authEmailDelivery: {
      send: async (message) => {
        sent.push(message);
      },
    },
  });
}

function captureLogs() {
  const calls: unknown[][] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => calls.push(args));
  return calls;
}

function sessionCookie(response: Response): string {
  return (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("core auth flow", () => {
  it("registers, sends verification email, creates and reads a session without leaking bearer urls", async () => {
    const logs = captureLogs();
    const sent: Sent = [];
    const auth = createAuthWithCapture(sent);
    const email = `flow-${crypto.randomUUID()}@example.com`;

    const signUp = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({
          name: "Auth Flow",
          email,
          password: "correct-horse-battery-staple",
        }),
      }),
    );
    expect(signUp.status).toBeLessThan(400);
    const signUpBody = (await signUp.json()) as { user?: { id: string } };
    expect(signUpBody.user?.id).toBeTruthy();

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("verification");
    expect(sent[0].recipient).toBe(email);
    expect(sent[0].url).toContain("/verify-email?token=");
    const logText = logs.flat().join(" ");
    expect(logText).not.toContain(sent[0].url);
    expect(logText).not.toContain(email);

    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?")
      .bind(signUpBody.user!.id)
      .run();

    const signIn = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
      }),
    );
    expect(signIn.status).toBeLessThan(400);
    const cookie = sessionCookie(signIn);
    expect(cookie).toContain("better-auth");

    const session = await auth.handler(
      new Request(`${baseUrl}/api/auth/get-session`, {
        method: "GET",
        headers: { cookie },
      }),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as { session?: unknown; user?: unknown };
    expect(sessionBody.user).toBeTruthy();
  });

  it("rejects requests from an untrusted origin before auth handling", async () => {
    const auth = createAuthWithCapture([]);
    const email = `flow-${crypto.randomUUID()}@example.com`;
    const response = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("INVALID_ORIGIN");
  });

  it("invalidates the session on sign-out", async () => {
    const auth = createAuthWithCapture([]);
    const email = `flow-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({
          name: "Auth Flow",
          email,
          password: "correct-horse-battery-staple",
        }),
      }),
    );
    const signUpBody = (await signUp.json()) as { user?: { id: string } };
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?")
      .bind(signUpBody.user!.id)
      .run();
    const signIn = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
      }),
    );
    const cookie = sessionCookie(signIn);

    const signOut = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-out`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl, cookie },
        body: "{}",
      }),
    );
    expect(signOut.status).toBeLessThan(400);

    const session = await auth.handler(
      new Request(`${baseUrl}/api/auth/get-session`, { method: "GET", headers: { cookie } }),
    );
    const sessionBody = (await session.json()) as { session?: unknown } | null;
    expect(sessionBody?.session ?? null).toBeNull();
  });

  it("routes password reset through the injected delivery without logging the url", async () => {
    const logs = captureLogs();
    const sent: Sent = [];
    const auth = createAuthWithCapture(sent);
    const email = `flow-${crypto.randomUUID()}@example.com`;
    await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({
          name: "Auth Flow",
          email,
          password: "correct-horse-battery-staple",
        }),
      }),
    );

    const forgot = await auth.handler(
      new Request(`${baseUrl}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ email, redirectTo: `${baseUrl}/reset-password` }),
      }),
    );
    expect(forgot.status).toBeLessThan(400);
    expect(sent.at(-1)?.kind).toBe("reset");
    expect(sent.at(-1)?.url).toContain("/reset-password");
    const logText = logs.flat().join(" ");
    expect(logText).not.toContain(sent.at(-1)!.url);
    expect(logText).not.toContain(email);
  });

  it("enables the google provider only when both credentials exist", async () => {
    const configured = createAuthWithCapture([], {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
    });
    const redirect = await configured.handler(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ provider: "google", callbackURL: baseUrl }),
      }),
    );
    expect(redirect.status).toBeLessThan(400);
    const location = redirect.headers.get("location");
    expect(location).toContain("https://accounts.google.com");

    const misconfigured = createAuthWithCapture([], { GOOGLE_CLIENT_ID: "client-id" });
    const rejected = await misconfigured.handler(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ provider: "google", callbackURL: baseUrl }),
      }),
    );
    expect(rejected.status).toBeGreaterThanOrEqual(400);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  UnavailableAuthEmailDelivery,
  createAuthEmailDelivery,
  type AuthEmailMessage,
} from "./email-delivery";
import { createAuth, type AuthEnvironment } from "./service";

const secretUrl = "https://freshmarkets.ph/reset?token=secret-token";

function captureLogs() {
  const calls: unknown[][] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => calls.push(args));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => calls.push(args));
  return calls;
}

function testAuthEnvironment(): AuthEnvironment {
  return {
    DB: env.DB,
    ENVIRONMENT: "development",
    BETTER_AUTH_URL: "http://127.0.0.1:8788",
    TRUSTED_ORIGINS: "http://127.0.0.1:8788",
    BETTER_AUTH_SECRET: "test-secret",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuthEmailDelivery", () => {
  it("forwards the full bearer url to the sender while logs stay redacted", async () => {
    const logs = captureLogs();
    const sender = vi.fn<(message: AuthEmailMessage) => Promise<void>>().mockResolvedValue(undefined);
    const delivery = createAuthEmailDelivery(sender);
    await delivery.send({
      kind: "reset",
      recipient: "customer@example.com",
      url: secretUrl,
    });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining("secret-token") }),
    );
    expect(JSON.stringify(logs)).not.toContain("secret-token");
    expect(JSON.stringify(logs)).not.toContain("customer@example.com");
  });
});

describe("UnavailableAuthEmailDelivery", () => {
  it("fails closed and logs only kind and configuration state", async () => {
    const logs = captureLogs();
    const delivery = new UnavailableAuthEmailDelivery();
    await expect(
      delivery.send({
        kind: "verification",
        recipient: "customer@example.com",
        url: secretUrl,
      }),
    ).rejects.toThrow("AUTH_EMAIL_DELIVERY_UNCONFIGURED");
    expect(logs.flat().join(" ")).toContain('"configured":false');
    expect(JSON.stringify(logs)).not.toContain("secret-token");
    expect(JSON.stringify(logs)).not.toContain("customer@example.com");
  });
});

describe("createAuth email wiring", () => {
  it("routes verification and reset sends through the injected delivery", async () => {
    const logs = captureLogs();
    const sent: AuthEmailMessage[] = [];
    const auth = createAuth(testAuthEnvironment(), {
      authEmailDelivery: {
        send: async (message) => {
          sent.push(message);
        },
      },
    });
    await auth.options.emailVerification.sendVerificationEmail(
      { user: { email: "customer@example.com" }, url: secretUrl, token: "opaque" },
      undefined,
    );
    await auth.options.emailAndPassword.sendResetPassword(
      { user: { email: "customer@example.com" }, url: secretUrl, token: "opaque" },
      undefined,
    );
    expect(sent).toEqual([
      { kind: "verification", recipient: "customer@example.com", url: secretUrl },
      { kind: "reset", recipient: "customer@example.com", url: secretUrl },
    ]);
    expect(JSON.stringify(logs)).not.toContain("secret-token");
    expect(JSON.stringify(logs)).not.toContain("customer@example.com");
  });

  it("uses the fail-closed delivery when none is injected", async () => {
    const logs = captureLogs();
    const auth = createAuth(testAuthEnvironment());
    await expect(
      auth.options.emailVerification.sendVerificationEmail(
        { user: { email: "customer@example.com" }, url: secretUrl, token: "opaque" },
        undefined,
      ),
    ).rejects.toThrow("AUTH_EMAIL_DELIVERY_UNCONFIGURED");
    expect(JSON.stringify(logs)).not.toContain("secret-token");
    expect(JSON.stringify(logs)).not.toContain("customer@example.com");
  });
});

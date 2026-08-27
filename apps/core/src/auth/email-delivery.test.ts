import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  UnavailableAuthEmailDelivery,
  createCloudflareAuthEmailDelivery,
  createAuthEmailDelivery,
  createRuntimeAuthEmailDelivery,
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
    BETTER_AUTH_URL: "http://localhost:3000",
    TRUSTED_ORIGINS: "http://localhost:3000",
    BETTER_AUTH_SECRET: "test-secret",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuthEmailDelivery", () => {
  it("forwards the full bearer url to the sender while logs stay redacted", async () => {
    const logs = captureLogs();
    const sender = vi
      .fn<(message: AuthEmailMessage) => Promise<void>>()
      .mockResolvedValue(undefined);
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

describe("createCloudflareAuthEmailDelivery", () => {
  it("sends verification and reset messages through the binding without exposing bearer data", async () => {
    const logs = captureLogs();
    const send = vi.fn().mockResolvedValue({ messageId: "message-id" });
    const delivery = createCloudflareAuthEmailDelivery({
      EMAIL: { send } as SendEmail,
      AUTH_EMAIL_FROM: "auth@freshmarkets.example",
      ENVIRONMENT: "test",
    });

    await delivery.send({
      kind: "verification",
      recipient: "customer@example.com",
      url: secretUrl,
    });

    expect(send).toHaveBeenCalledWith({
      to: "customer@example.com",
      from: { email: "auth@freshmarkets.example", name: "FreshMarkets" },
      subject: "Verify your FreshMarkets email",
      text: expect.stringContaining(secretUrl),
      html: expect.stringContaining(secretUrl),
    });
    expect(JSON.stringify(logs)).not.toContain("secret-token");
    expect(JSON.stringify(logs)).not.toContain("customer@example.com");
  });

  it("fails closed when production sender configuration is missing", async () => {
    const delivery = createCloudflareAuthEmailDelivery({
      EMAIL: { send: vi.fn() } as unknown as SendEmail,
      ENVIRONMENT: "production",
    });

    await expect(
      delivery.send({ kind: "reset", recipient: "customer@example.com", url: secretUrl }),
    ).rejects.toThrow("AUTH_EMAIL_DELIVERY_UNCONFIGURED");
  });
});

describe("createRuntimeAuthEmailDelivery", () => {
  it("uses an explicit no-network fake in the Worker test environment", async () => {
    const delivery = createRuntimeAuthEmailDelivery({ ENVIRONMENT: "test" });
    await expect(
      delivery.send({ kind: "verification", recipient: "customer@example.com", url: secretUrl }),
    ).resolves.toBeUndefined();
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

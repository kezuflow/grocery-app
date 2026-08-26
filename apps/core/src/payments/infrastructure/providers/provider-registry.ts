import type { PaymentProvider } from "../../ports/payment-provider";

export class FakeProviderProductionError extends Error {
  constructor() {
    super("FAKE_PROVIDER_BLOCKED_OUTSIDE_TEST");
    this.name = "FakeProviderProductionError";
  }
}

/**
 * Holds configured production adapters behind stable codes. The `fake`
 * adapter is part of the port contract tests and can never be registered
 * outside the `test` environment, so production always fails closed until a
 * real provider is selected and configured.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(environment: string | undefined, providers: readonly PaymentProvider[] = []) {
    for (const provider of providers) {
      this.register(provider, environment);
    }
  }

  register(provider: PaymentProvider, environment: string | undefined): void {
    if (provider.code === "fake" && environment !== "test") {
      throw new FakeProviderProductionError();
    }
    this.providers.set(provider.code, provider);
  }

  get(providerCode: string): PaymentProvider | null {
    return this.providers.get(providerCode) ?? null;
  }

  require(providerCode: string): PaymentProvider {
    const provider = this.providers.get(providerCode);
    if (!provider) throw new Error(`PAYMENT_PROVIDER_UNCONFIGURED:${providerCode}`);
    return provider;
  }
}

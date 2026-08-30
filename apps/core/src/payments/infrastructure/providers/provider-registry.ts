import type { PaymentProvider } from "../../ports/payment-provider";
import type { PaymentProviderRegistry } from "../../ports/provider-registry";

export class MockProviderEnvironmentError extends Error {
  constructor() {
    super("MOCK_PROVIDER_BLOCKED_OUTSIDE_ALLOWED_ENVIRONMENT");
    this.name = "MockProviderEnvironmentError";
  }
}

/**
 * Holds configured adapters behind stable codes. The deterministic `mock`
 * adapter is allowed only in development and test, so preview, staging, and
 * production fail closed even when they are accidentally configured for it.
 */
export class ProviderRegistry implements PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(environment: string | undefined, providers: readonly PaymentProvider[] = []) {
    for (const provider of providers) {
      this.register(provider, environment);
    }
  }

  register(provider: PaymentProvider, environment: string | undefined): void {
    if (provider.code === "mock" && environment !== "development" && environment !== "test") {
      throw new MockProviderEnvironmentError();
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

import type { PaymentProvider } from "./payment-provider";

/** Provider lookup exposed by Payments without leaking concrete adapter composition. */
export interface PaymentProviderRegistry {
  get(providerCode: string): PaymentProvider | null;
  require(providerCode: string): PaymentProvider;
}

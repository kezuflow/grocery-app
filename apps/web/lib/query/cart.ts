"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CartView, CheckoutBootstrapView, RpcResult } from "@freshmarkets/contracts";
import { useQueryEpoch } from "../../components/query-provider";
import { queryKeys } from "./query-client";
import { CART_CHANGED_EVENT, cartLoadError, fetchCart } from "../storefront/cart-client";

export const cartResource = "cart";
export type CheckoutDraft = { addressId: string; promotionCodes: readonly string[] };

/**
 * The cart loader may transfer a saved guest cart. It is serialized by cart-client
 * and deliberately opts out of React Query retries and cancellation.
 */
export function useCartQuery(options: { enabled?: boolean; fresh?: boolean } = {}) {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  const key = queryKeys.private(epoch, cartResource);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchCart({ fresh: options.fresh }),
    enabled: options.enabled ?? true,
    retry: false,
  });

  useEffect(() => {
    const accept = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: CartView | null }>).detail;
      if ("view" in (detail ?? {})) client.setQueryData(key, detail.view ?? null);
    };
    window.addEventListener(CART_CHANGED_EVENT, accept);
    return () => window.removeEventListener(CART_CHANGED_EVENT, accept);
  }, [client, epoch]);

  return { ...query, cart: query.data ?? null, cartError: cartLoadError() };
}

export function useAcceptCart() {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  return (view: CartView | null) =>
    client.setQueryData(queryKeys.private(epoch, cartResource), view);
}

export function useInvalidateCheckoutReads() {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.private(epoch, "checkout-bootstrap") }),
      client.invalidateQueries({ queryKey: queryKeys.private(epoch, "checkout-fulfillment") }),
    ]);
  };
}

export function useCheckoutBootstrapOwner() {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  const key = queryKeys.private(epoch, "checkout-bootstrap");
  const read = () =>
    client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const response = await fetch("/api/checkout/bootstrap", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const result = (await response.json()) as RpcResult<CheckoutBootstrapView>;
        if (!response.ok || !result.ok)
          throw new Error(
            result.ok ? "Delivery details could not be loaded." : result.error.message,
          );
        return result.value;
      },
    });
  return {
    read,
    refresh: async () => {
      await client.cancelQueries({ queryKey: key, exact: true });
      await client.invalidateQueries({ queryKey: key, exact: true });
      return read();
    },
    accept: (value: CheckoutBootstrapView) => client.setQueryData(key, value),
    invalidate: () => client.invalidateQueries({ queryKey: key }),
  };
}

export function useAccountAddressOwner() {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  const key = queryKeys.private(epoch, "account-addresses");
  const read = () =>
    client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const [addressResponse, profileResponse] = await Promise.all(
          ["/api/commerce/address", "/api/commerce/profile"].map((url) =>
            fetch(url, { credentials: "same-origin", cache: "no-store" }),
          ),
        );
        const addresses = (await addressResponse.json()) as RpcResult<
          CheckoutBootstrapView["addresses"]
        >;
        const profile = (await profileResponse.json()) as RpcResult<
          CheckoutBootstrapView["profile"]
        >;
        if (!addressResponse.ok || !profileResponse.ok || !addresses.ok || !profile.ok)
          throw new Error("Address account reads unavailable");
        return { addresses: addresses.value, profile: profile.value };
      },
    });
  return {
    read,
    refresh: async () => {
      await client.cancelQueries({ queryKey: key, exact: true });
      await client.invalidateQueries({ queryKey: key, exact: true });
      return read();
    },
    invalidate: () => client.invalidateQueries({ queryKey: key }),
  };
}

export function useCheckoutDraft() {
  const epoch = useQueryEpoch();
  const client = useQueryClient();
  const key = queryKeys.private(epoch, "checkout-draft");
  return {
    initial: client.getQueryData<CheckoutDraft>(key) ?? { addressId: "", promotionCodes: [] },
    save: (draft: CheckoutDraft) => client.setQueryData(key, draft),
  };
}

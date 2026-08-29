"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CustomerAddressView, RpcResult } from "@freshmarkets/contracts";
import { StorefrontShell } from "../../../components/storefront/storefront-shell";
import { AddressEditor } from "../../../components/storefront/address/address-editor";
import { AddressList } from "../../../components/storefront/address/address-list";

export function AddressBookClient({ publicAccessToken }: { publicAccessToken?: string }) {
  const [addresses, setAddresses] = useState<ReadonlyArray<CustomerAddressView>>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedAddressId, setSelectedAddressId] = useState<string>();
  const [editingAddress, setEditingAddress] = useState<CustomerAddressView>();
  const [announcement, setAnnouncement] = useState("");

  const loadAddresses = useCallback(async (confirmedAddressId?: string) => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/commerce/address", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = (await response.json()) as RpcResult<ReadonlyArray<CustomerAddressView>>;
      if (!response.ok || !result.ok) {
        setLoadState("error");
        return;
      }
      setAddresses(result.value);
      setLoadState("ready");
      if (confirmedAddressId) {
        setSelectedAddressId(confirmedAddressId);
        setEditingAddress(undefined);
        setAnnouncement("Delivery address saved and refreshed.");
      }
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  return (
    <StorefrontShell>
      <div className="min-h-[100dvh] w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <Link href="/account" className="text-sm font-semibold underline underline-offset-4">
          Back to account
        </Link>
        <div className="mt-6 max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Account
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em]">Delivery addresses</h1>
          <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
            Confirm the exact entrance for each destination. Core checks delivery coverage whenever
            you save and again at checkout.
          </p>

          <section className="mt-7 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
            <h2 className="text-lg font-bold">Saved addresses</h2>
            <div className="mt-4">
              {loadState === "loading" ? (
                <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                  Loading saved delivery addresses…
                </p>
              ) : loadState === "error" ? (
                <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
                  <p>Saved addresses could not be loaded. Sign in or try again.</p>
                  <button
                    type="button"
                    onClick={() => void loadAddresses()}
                    className="mt-3 rounded-lg border border-red-300 px-3 py-2 font-semibold"
                  >
                    Retry address load
                  </button>
                </div>
              ) : (
                <AddressList
                  addresses={addresses}
                  selectedAddressId={selectedAddressId}
                  onSelect={setSelectedAddressId}
                  onCorrect={setEditingAddress}
                />
              )}
            </div>
          </section>

          <section className="mt-6 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">
                  {editingAddress ? `Correct ${editingAddress.label}` : "Add a delivery address"}
                </h2>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Unavailable destinations remain saved for correction but cannot be used at
                  checkout.
                </p>
              </div>
              {editingAddress ? (
                <button
                  type="button"
                  onClick={() => setEditingAddress(undefined)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                >
                  Add a different address
                </button>
              ) : null}
            </div>
            <AddressEditor
              key={editingAddress?.id ?? "new-address"}
              publicAccessToken={publicAccessToken}
              initialAddress={editingAddress}
              onConfirmed={(addressId) => void loadAddresses(addressId)}
            />
          </section>
          {announcement ? (
            <p role="status" className="mt-4 text-sm text-[var(--fm-text-muted)]">
              {announcement}
            </p>
          ) : null}
        </div>
      </div>
    </StorefrontShell>
  );
}

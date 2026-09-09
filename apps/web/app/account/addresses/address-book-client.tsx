"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CustomerAddressView,
  CustomerProfileView,
  ManagedCustomerAddress,
  RpcResult,
} from "@freshmarkets/contracts";
import { StorefrontShell } from "../../../components/storefront/storefront-shell";
import { AddressEditor } from "../../../components/storefront/address/address-editor";
import { AddressList } from "../../../components/storefront/address/address-list";

export function AddressBookClient({ publicAccessToken }: { publicAccessToken?: string }) {
  const [addresses, setAddresses] = useState<ReadonlyArray<CustomerAddressView>>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedAddressId, setSelectedAddressId] = useState<string>();
  const [editingAddress, setEditingAddress] = useState<CustomerAddressView>();
  const [announcement, setAnnouncement] = useState("");
  const [profile, setProfile] = useState<CustomerProfileView>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const addressLoadGeneration = useRef(0);

  const loadAddresses = useCallback(async (confirmedAddressId?: string) => {
    const generation = ++addressLoadGeneration.current;
    setLoadState("loading");
    try {
      const [response, profileResponse] = await Promise.all(
        ["/api/commerce/address", "/api/commerce/profile"].map((url) =>
          fetch(url, { credentials: "same-origin", cache: "no-store" }),
        ),
      );
      if (!response || !profileResponse) throw new Error("Address account reads unavailable");
      const result = (await response.json()) as RpcResult<ReadonlyArray<CustomerAddressView>>;
      const loadedProfile = (await profileResponse.json()) as RpcResult<CustomerProfileView>;
      if (generation !== addressLoadGeneration.current) return;
      if (!response.ok || !result.ok || !profileResponse.ok || !loadedProfile.ok) {
        setLoadState("error");
        return;
      }
      setAddresses(result.value);
      setProfile(loadedProfile.value);
      setSelectedAddressId((current) => {
        const nextId = confirmedAddressId ?? current ?? loadedProfile.value.defaultAddressId;
        return result.value.some((address) => address.id === nextId && address.serviceable === true)
          ? (nextId ?? undefined)
          : undefined;
      });
      setLoadState("ready");
      if (confirmedAddressId) {
        setEditingAddress(undefined);
        setAnnouncement("Delivery address saved and refreshed.");
      }
    } catch {
      if (generation !== addressLoadGeneration.current) return;
      setLoadState("error");
    }
  }, []);

  async function manage(action?: "SET_DEFAULT" | "REMOVE", address?: CustomerAddressView) {
    if (inFlight.current) return;
    if (!pending.current) {
      if (!action || !address || !profile) return;
      pending.current = {
        key: crypto.randomUUID(),
        body: JSON.stringify({
          action,
          addressId: address.id,
          expectedAddressVersion: address.version,
          expectedVersion: profile.version,
        }),
      };
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/commerce/address/manage", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.current.key },
        body: pending.current.body,
      });
      const result = (await response.json()) as RpcResult<ManagedCustomerAddress>;
      setAnnouncement(
        result.ok
          ? result.value.status === "disabled"
            ? "Address removed. Existing Orders keep their delivery details."
            : "Default address saved."
          : result.error.message,
      );
      pending.current = null;
      setUncertain(false);
      setEditingAddress(undefined);
      await loadAddresses();
    } catch {
      setUncertain(true);
      setAnnouncement("The address change could not be confirmed. Retry the same change.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAddresses();
    return () => {
      addressLoadGeneration.current += 1;
    };
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

          <fieldset disabled={busy || uncertain}>
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
                    defaultAddressId={profile?.defaultAddressId}
                    onManage={(action, address) => void manage(action, address)}
                  />
                )}
              </div>
            </section>

            <section className="mt-6 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">
                    {editingAddress
                      ? `${editingAddress.serviceable === true ? "Edit" : "Correct"} ${editingAddress.label}`
                      : "Add a delivery address"}
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
              {loadState === "ready" ? (
                <AddressEditor
                  key={editingAddress?.id ?? "new-address"}
                  publicAccessToken={publicAccessToken}
                  initialAddress={editingAddress}
                  defaultPhone={profile?.accountPhone ?? undefined}
                  onConfirmed={(addressId) => void loadAddresses(addressId)}
                />
              ) : null}
            </section>
          </fieldset>
          {uncertain ? (
            <button
              type="button"
              disabled={busy}
              className="mt-4 underline"
              onClick={() => void manage()}
            >
              Retry address change
            </button>
          ) : null}
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

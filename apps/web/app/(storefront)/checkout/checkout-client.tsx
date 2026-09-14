"use client";
import { ArrowLeft, CheckCircle2, MapPin, Plus, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  CartView,
  CheckoutQuoteView,
  CustomerAddressView,
  CustomerProfileView,
  FulfillmentOptionView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { OrderSummary } from "../../../components/storefront/marketplace/order-summary";
import { AddressEditor } from "../../../components/storefront/address/address-editor";
import { AddressList } from "../../../components/storefront/address/address-list";
import { PromotionEntry } from "../../../components/storefront/checkout/promotion-entry";
import { CheckoutTotalReview } from "../../../components/storefront/checkout/checkout-total-review";
import { FulfillmentOptionPicker } from "../../../components/storefront/checkout/fulfillment-option-picker";
import { addToCart, fetchCart, refreshCartForLocation } from "../../../lib/storefront/cart-client";
import {
  readDeliveryLocationSelection,
  rememberDeliveryLocationSelection,
} from "../../../lib/storefront/browsing-location";
import { readJson } from "../../../lib/http/read-deadline";
import {
  useAcceptCart,
  useAccountAddressOwner,
  useCartQuery,
  useCheckoutBootstrapOwner,
  useCheckoutDraft,
  useInvalidateCheckoutReads,
} from "../../../lib/query/cart";

const COURIER_QUOTE_REFRESH_INTERVAL_MS = 4.5 * 60_000;
const COURIER_QUOTE_EXPIRY_BUFFER_MS = 30_000;
const PAYMENT_ACTION_STORAGE_KEY = "freshmarkets.checkoutPaymentAction";
const CHECKOUT_PAYMENT_IN_PROGRESS_REASON = "CHECKOUT_PAYMENT_IN_PROGRESS";

function readPaymentContinuation(): PaymentActionView | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PAYMENT_ACTION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const action = JSON.parse(raw) as PaymentActionView;
    const actionable =
      (action.actionType === "REDIRECT" && Boolean(action.redirectUrl)) ||
      (action.actionType === "SDK" && Boolean(action.clientToken));
    if (!actionable || (action.expiresAt && Date.parse(action.expiresAt) <= Date.now()))
      throw new Error("expired");
    return action;
  } catch {
    window.sessionStorage.removeItem(PAYMENT_ACTION_STORAGE_KEY);
    return null;
  }
}

function paymentContinuationHref(action: PaymentActionView | null): string {
  if (action?.actionType === "REDIRECT" && action.redirectUrl) return action.redirectUrl;
  if (action?.actionType === "SDK" && action.clientToken) return "/checkout/payment";
  return "/orders?payment=return";
}

function displayAddress(address: CustomerAddressView): string {
  return [
    address.components.addressLine1,
    address.components.addressLine2,
    address.components.barangay,
    address.components.city,
    address.components.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function CheckoutClient({
  browserApiKey,
  mapId,
}: {
  browserApiKey?: string;
  mapId?: string;
}) {
  const carriedDestination = useRef(readDeliveryLocationSelection());
  const cartQuery = useCartQuery({ fresh: true });
  const cart = cartQuery.cart;
  const acceptCart = useAcceptCart();
  const invalidateCheckoutReads = useInvalidateCheckoutReads();
  const checkoutBootstrap = useCheckoutBootstrapOwner();
  const accountAddresses = useAccountAddressOwner();
  const checkoutDraft = useCheckoutDraft();
  const [fulfillmentOptions, setFulfillmentOptions] = useState<readonly FulfillmentOptionView[]>(
    [],
  );
  const [fulfillmentLoadState, setFulfillmentLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [fulfillmentError, setFulfillmentError] = useState("");
  const [addresses, setAddresses] = useState<ReadonlyArray<CustomerAddressView>>([]);
  const [profile, setProfile] = useState<CustomerProfileView | null>(null);
  const [addressLoadState, setAddressLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [editingAddress, setEditingAddress] = useState<CustomerAddressView>();
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [showSavedAddresses, setShowSavedAddresses] = useState(true);
  const initialAddressId =
    checkoutDraft.initial.addressId || carriedDestination.current?.savedAddressId || "";
  const [addressId, setAddressId] = useState(initialAddressId);
  const [fulfillmentOptionId, setFulfillmentOptionId] = useState("");
  const [updatingSkuId, setUpdatingSkuId] = useState<string | null>(null);
  const selectedAddressId = useRef(initialAddressId);
  const selectedFulfillmentOptionId = useRef("");
  const [status, setStatus] = useState("");
  const [promotionCodes, setPromotionCodes] = useState<readonly string[]>(
    checkoutDraft.initial.promotionCodes,
  );
  const promotionCodesRef = useRef<readonly string[]>(checkoutDraft.initial.promotionCodes);
  const [acceptingPayment, setAcceptingPayment] = useState(false);
  const paymentInProgressRef = useRef(false);
  const paymentContinuationRef = useRef<PaymentActionView | null>(null);
  const [quoteLoadState, setQuoteLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [quoteError, setQuoteError] = useState("");
  const [pendingQuote, setPendingQuote] = useState<
    | (CheckoutQuoteView & {
        input: {
          addressId: string;
          fulfillmentOptionId: string;
          cartVersion: number;
          promotionCodes: readonly string[];
        };
        attemptKey: string;
      })
    | null
  >(null);
  const pendingQuoteRef = useRef(pendingQuote);
  pendingQuoteRef.current = pendingQuote;
  const fulfillmentOptionsRef = useRef(fulfillmentOptions);
  fulfillmentOptionsRef.current = fulfillmentOptions;
  const releaseInFlight = useRef<Promise<boolean> | null>(null);
  const quoteRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptKey = useRef(`checkout-${crypto.randomUUID()}`);
  const addressLoadGeneration = useRef(0);
  const fulfillmentLoadGeneration = useRef(0);
  const addressSelectionGeneration = useRef(0);
  useEffect(() => {
    const continuation = readPaymentContinuation();
    paymentContinuationRef.current = continuation;
  }, []);
  useEffect(() => {
    if (!cart?.paymentInProgress) return;
    clearQuoteRefreshTimer();
    paymentInProgressRef.current = true;
    window.location.replace(paymentContinuationHref(paymentContinuationRef.current));
  }, [cart?.paymentInProgress]);
  useEffect(() => {
    const address = addresses.find((entry) => entry.id === addressId && entry.confirmedAt);
    if (address && cart) void loadFulfillmentOptions(address);
    else {
      setFulfillmentOptions([]);
      setFulfillmentLoadState("idle");
    }
    return () => {
      fulfillmentLoadGeneration.current += 1;
    };
  }, [cart, addressId, addresses]);
  useEffect(() => {
    if (cartQuery.data?.id === "guest-cart") {
      setStatus("Your cart is saved. Sign in before checkout so we can confirm your delivery.");
    }
    void loadAddresses();
    return () => {
      addressLoadGeneration.current += 1;
    };
  }, []);
  useEffect(
    () => () => {
      clearQuoteRefreshTimer();
    },
    [],
  );

  function clearQuoteRefreshTimer() {
    if (quoteRefreshTimer.current !== null) {
      clearTimeout(quoteRefreshTimer.current);
      quoteRefreshTimer.current = null;
    }
  }

  function scheduleQuoteRefresh(quote: NonNullable<typeof pendingQuote>) {
    clearQuoteRefreshTimer();
    const staleAt = Date.parse(quote.expiresAt) - COURIER_QUOTE_EXPIRY_BUFFER_MS;
    const untilStale = staleAt - Date.now();
    const delay = Number.isFinite(untilStale)
      ? Math.max(0, Math.min(COURIER_QUOTE_REFRESH_INTERVAL_MS, untilStale))
      : COURIER_QUOTE_REFRESH_INTERVAL_MS;
    quoteRefreshTimer.current = setTimeout(() => {
      quoteRefreshTimer.current = null;
      if (pendingQuoteRef.current?.quoteId !== quote.quoteId || !quoteInputIsCurrent(quote.input))
        return;
      const option = fulfillmentOptionsRef.current.find(
        (candidate) => candidate.optionId === quote.input.fulfillmentOptionId,
      );
      if (option) void reviewTotal(option);
    }, delay);
  }

  async function loadAddresses(preferredAddressId?: string, refreshedCart?: CartView | null) {
    const generation = ++addressLoadGeneration.current;
    setAddressLoadState("loading");
    try {
      const bootstrap = preferredAddressId
        ? await checkoutBootstrap.refresh()
        : await checkoutBootstrap.read();
      if (generation !== addressLoadGeneration.current) return;
      setAddresses(bootstrap.addresses);
      if (refreshedCart !== undefined) acceptCart(refreshedCart);
      setProfile(bootstrap.profile);
      setAddressLoadState("ready");
      const browsingDestination = carriedDestination.current;
      const requestedAddressId =
        preferredAddressId ??
        (selectedAddressId.current ||
          (browsingDestination ? null : bootstrap.profile.defaultAddressId));
      const confirmed = bootstrap.addresses.find((address) => address.id === requestedAddressId);
      setCurrentAddress(confirmed?.confirmedAt ? confirmed.id : "");
      setShowSavedAddresses(!confirmed?.confirmedAt);
      if (!(await invalidatePendingQuote())) return;
      if (preferredAddressId) {
        if (confirmed?.confirmedAt) {
          await applySelectedAddress(confirmed);
          setStatus("Address confirmed. Your cart was rechecked for this destination.");
        } else {
          setStatus("Confirm this saved address pin before using it at checkout.");
        }
        setEditingAddress(undefined);
        setShowAddressEditor(false);
      } else if (requestedAddressId && !confirmed) {
        setStatus(
          "The Deliver to address is no longer available to this account. Choose or add an address to continue.",
        );
      } else if (!requestedAddressId && browsingDestination) {
        setShowAddressEditor(true);
        setStatus("Your Deliver to destination is ready. Add the missing delivery details.");
      }
    } catch {
      if (generation !== addressLoadGeneration.current) return;
      setAddressLoadState("error");
      setFulfillmentLoadState("error");
      setFulfillmentError("Delivery details could not be refreshed. Please try again.");
    }
  }

  function setCurrentAddress(nextAddressId: string) {
    selectedAddressId.current = nextAddressId;
    setAddressId(nextAddressId);
    checkoutDraft.save({ addressId: nextAddressId, promotionCodes: promotionCodesRef.current });
  }

  async function abandonQuote(quote: CheckoutQuoteView): Promise<boolean> {
    try {
      const response = await fetch(
        `/api/checkout/quote/${encodeURIComponent(quote.quoteId)}/abandon`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `checkout-abandon-${quote.quoteId}`,
          },
          body: JSON.stringify({ expectedVersion: quote.attemptVersion }),
        },
      );
      const result = (await response.json()) as RpcResult<unknown>;
      return result.ok;
    } catch {
      return false;
    }
  }

  async function invalidatePendingQuote(): Promise<boolean> {
    if (releaseInFlight.current) return releaseInFlight.current;
    const quote = pendingQuoteRef.current;
    clearQuoteRefreshTimer();
    if (!quote) {
      attemptKey.current = `checkout-${crypto.randomUUID()}`;
      setQuoteLoadState("idle");
      setQuoteError("");
      return true;
    }
    setStatus("Releasing the current checkout reservation…");
    const operation = (async () => {
      if (!(await abandonQuote(quote))) {
        setStatus(
          "The current checkout could not be released safely. Try again before restarting.",
        );
        return false;
      }
      pendingQuoteRef.current = null;
      setPendingQuote(null);
      setQuoteLoadState("idle");
      setQuoteError("");
      attemptKey.current = `checkout-${crypto.randomUUID()}`;
      return true;
    })();
    releaseInFlight.current = operation;
    try {
      return await operation;
    } finally {
      releaseInFlight.current = null;
    }
  }

  async function loadFulfillmentOptions(address: CustomerAddressView) {
    const generation = ++fulfillmentLoadGeneration.current;
    setFulfillmentOptions([]);
    setFulfillmentError("");
    if (!cart || cart.id === "guest-cart" || !cart.items.length) {
      setFulfillmentLoadState("idle");
      return;
    }
    setFulfillmentLoadState("loading");
    try {
      const result = await readJson<RpcResult<readonly FulfillmentOptionView[]>>(
        "/api/checkout/fulfillment-options",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            addressId: address.id,
            addressVersion: address.version,
            cartId: cart.id,
            cartVersion: cart.version,
          }),
        },
      );
      if (generation !== fulfillmentLoadGeneration.current) return;
      if (result.ok) {
        setFulfillmentOptions(result.value);
        fulfillmentOptionsRef.current = result.value;
        setFulfillmentLoadState("ready");
        const eligible = result.value.filter((option) => option.eligible);
        if (
          !paymentInProgressRef.current &&
          eligible.length === 1 &&
          eligible[0]?.mode === "SCHEDULED"
        )
          void reviewTotal(eligible[0]);
        return;
      }
      setFulfillmentLoadState("error");
      setFulfillmentError(result.error.message);
    } catch {
      if (generation !== fulfillmentLoadGeneration.current) return;
      setFulfillmentLoadState("error");
      setFulfillmentError("Delivery options could not be loaded. Please try again.");
    }
  }

  async function retryDeliveryOptions() {
    if (!(await invalidatePendingQuote())) return;
    // Refresh both versioned inputs: retrying a stale cart/address repeats the rejection.
    setFulfillmentLoadState("loading");
    setFulfillmentOptions([]);
    try {
      const refreshedCart = (await fetchCart({ fresh: true })) ?? null;
      await loadAddresses(selectedAddressId.current, refreshedCart);
    } catch {
      setFulfillmentLoadState("error");
      setFulfillmentError("Delivery details could not be refreshed. Please try again.");
    }
  }

  async function discardPendingQuote() {
    if (await invalidatePendingQuote()) {
      setStatus("Current checkout released. You can choose new delivery details.");
    }
  }

  function quoteInputIsCurrent(input: {
    addressId: string;
    fulfillmentOptionId: string;
    cartVersion: number;
    promotionCodes: readonly string[];
  }) {
    return (
      input.addressId === selectedAddressId.current &&
      input.fulfillmentOptionId === selectedFulfillmentOptionId.current &&
      input.cartVersion === cart?.version &&
      input.promotionCodes.join("\u0000") === promotionCodesRef.current.join("\u0000")
    );
  }

  async function selectAddress(nextAddressId: string) {
    if (paymentInProgressRef.current) {
      setStatus("This checkout is locked while its payment is being confirmed.");
      return;
    }
    if (!(await invalidatePendingQuote())) return;
    const selected = addresses.find((address) => address.id === nextAddressId);
    if (!selected?.confirmedAt) {
      setCurrentAddress("");
      setStatus("Confirm this saved address pin before using it at checkout.");
      return;
    }
    await applySelectedAddress(selected);
    setShowSavedAddresses(false);
    setStatus("Delivery address selected. Your cart was rechecked for this destination.");
  }

  async function applySelectedAddress(selected: CustomerAddressView) {
    const generation = ++addressSelectionGeneration.current;
    const destination = {
      displayAddress: displayAddress(selected),
      coordinate: { latitude: selected.latitude, longitude: selected.longitude },
      savedAddressId: selected.id,
    };
    carriedDestination.current = destination;
    rememberDeliveryLocationSelection(destination);
    const refreshed = await refreshCartForLocation();
    if (generation !== addressSelectionGeneration.current) return;
    if (!refreshed) {
      setCurrentAddress("");
      setStatus(
        "The cart could not be assigned to this destination. Review the address and retry.",
      );
      return;
    }
    acceptCart(refreshed);
    await invalidateCheckoutReads();
    setCurrentAddress(selected.id);
    selectedFulfillmentOptionId.current = "";
    setFulfillmentOptionId("");
  }
  async function reviewTotal(option: FulfillmentOptionView) {
    if (paymentInProgressRef.current) {
      setStatus("Payment has already started. Continue it or check its status instead.");
      return;
    }
    if (!cart || !addressId) {
      setStatus("Confirm a delivery address first.");
      return;
    }
    if (cart.id === "guest-cart") {
      setStatus("Your cart is saved. Sign in before checkout so we can confirm your delivery.");
      return;
    }
    if (pendingQuoteRef.current || option.optionId !== selectedFulfillmentOptionId.current) {
      if (!(await invalidatePendingQuote())) return;
      selectedFulfillmentOptionId.current = option.optionId;
      setFulfillmentOptionId(option.optionId);
      setStatus("Checking the selected delivery range and current total.");
    }
    const quoteInput = {
      addressId: selectedAddressId.current,
      fulfillmentOptionId: option.optionId,
      cartVersion: cart.version,
      promotionCodes: promotionCodesRef.current,
    };
    const quoteAttemptKey = attemptKey.current;
    if (!quoteInputIsCurrent(quoteInput) || quoteAttemptKey !== attemptKey.current) return;
    setQuoteLoadState("loading");
    setQuoteError("");
    setStatus("Checking the Lalamove route and delivery fee…");
    // 1) Core-authoritative quote. Core recalculates before payment and any
    // changed total must be accepted through a new attempt.
    try {
      const quoteResponse = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": quoteAttemptKey,
        },
        body: JSON.stringify({
          cartId: cart.id,
          cartVersion: cart.version,
          addressId,
          fulfillmentOptionId: option.optionId,
          promotionCodes: promotionCodesRef.current,
        }),
      });
      const quoteResult = (await quoteResponse.json()) as RpcResult<CheckoutQuoteView>;
      if (!quoteInputIsCurrent(quoteInput) || quoteAttemptKey !== attemptKey.current) return;
      if (!quoteResult.ok) {
        const message = quoteResult.error?.message ?? "The delivery fee could not be confirmed.";
        setPendingQuote(null);
        if (quoteResult.error?.details?.reason === CHECKOUT_PAYMENT_IN_PROGRESS_REASON) {
          clearQuoteRefreshTimer();
          paymentInProgressRef.current = true;
          const continuation = readPaymentContinuation();
          paymentContinuationRef.current = continuation;
          setQuoteLoadState("idle");
          setQuoteError("");
          setStatus("Payment has already started. Your cart is locked until it is confirmed.");
          window.location.replace(paymentContinuationHref(readPaymentContinuation()));
          return;
        }
        setQuoteLoadState("error");
        setQuoteError(`${message} Retry the delivery quotation.`);
        setStatus("");
        return;
      }
      if (!quoteResult.value) {
        setQuoteLoadState("error");
        setQuoteError("The delivery fee could not be confirmed. Retry the delivery quotation.");
        setStatus("");
        return;
      }
      const acceptedQuote = {
        ...quoteResult.value,
        input: quoteInput,
        attemptKey: quoteAttemptKey,
      };
      pendingQuoteRef.current = acceptedQuote;
      setPendingQuote(acceptedQuote);
      scheduleQuoteRefresh(acceptedQuote);
      setQuoteLoadState("idle");
      setStatus(
        `Review your current total: ${quoteResult.value.currency} ${(quoteResult.value.totalMinor / 100).toFixed(2)}.`,
      );
    } catch {
      if (!quoteInputIsCurrent(quoteInput) || quoteAttemptKey !== attemptKey.current) return;
      setPendingQuote(null);
      setQuoteLoadState("error");
      setQuoteError(
        "The delivery fee could not be confirmed because Lalamove could not be reached. Retry the delivery quotation.",
      );
      setStatus("");
    }
  }

  async function updateCartQuantity(item: CartView["items"][number], quantity: number) {
    if (updatingSkuId || paymentInProgressRef.current) {
      if (paymentInProgressRef.current)
        setStatus("This cart is locked while its payment is being confirmed.");
      return;
    }
    setUpdatingSkuId(item.skuId);
    try {
      if (!(await invalidatePendingQuote())) return;
      const result = await addToCart(item.skuId, quantity, {
        name: item.name,
        unitPriceMinor: item.unitPriceMinor,
        currency: cart?.currency ?? "PHP",
        media: item.media ?? null,
      });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      acceptCart(result.view);
      await invalidateCheckoutReads();
      selectedFulfillmentOptionId.current = "";
      setFulfillmentOptionId("");
      setStatus(
        result.view.items.length
          ? "Quantity updated. Choose a delivery option again to confirm the current total."
          : "Your cart is empty. Add an item before continuing checkout.",
      );
    } finally {
      setUpdatingSkuId(null);
    }
  }

  async function confirmPayment() {
    if (releaseInFlight.current) {
      setStatus("Wait for the current checkout reservation to be released.");
      return;
    }
    if (!pendingQuote) return;
    if (
      !quoteInputIsCurrent(pendingQuote.input) ||
      pendingQuote.attemptKey !== attemptKey.current
    ) {
      if (!(await invalidatePendingQuote())) return;
      setStatus("Delivery details changed. Review the current total again before payment.");
      return;
    }
    // 2) Canonical payment intent. Order commitment happens in Core from the
    // provider-confirmed payment reaction — never from this browser.
    clearQuoteRefreshTimer();
    setAcceptingPayment(true);
    const paymentResponse = await fetch("/api/checkout/payment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": pendingQuote.attemptKey,
      },
      body: JSON.stringify({
        checkoutAttemptId: pendingQuote.quoteId,
        expectedQuoteVersion: pendingQuote.attemptVersion,
        expectedPriceAcceptanceVersion: pendingQuote.priceAcceptanceVersion,
        expectedCurrency: pendingQuote.currency,
        expectedMerchandiseSubtotalMinor: pendingQuote.merchandiseSubtotalMinor,
        expectedItemDiscountMinor: pendingQuote.itemDiscountMinor,
        expectedOrderDiscountMinor: pendingQuote.orderDiscountMinor,
        expectedDeliverySubtotalMinor: pendingQuote.deliverySubtotalMinor,
        expectedDeliveryFeeMinor: pendingQuote.deliveryFeeMinor,
        expectedDeliveryDiscountMinor: pendingQuote.deliveryDiscountMinor,
        expectedTaxMinor: pendingQuote.taxMinor,
        expectedTotalMinor: pendingQuote.totalMinor,
        returnUrl: window.location.origin + "/orders",
      }),
    });
    const paymentResult = (await paymentResponse.json()) as RpcResult<PaymentActionView>;
    setAcceptingPayment(false);
    if (paymentResult.ok) {
      const continuation =
        (paymentResult.value.actionType === "REDIRECT" && paymentResult.value.redirectUrl) ||
        (paymentResult.value.actionType === "SDK" && paymentResult.value.clientToken)
          ? paymentResult.value
          : null;
      paymentInProgressRef.current = true;
      paymentContinuationRef.current = continuation;
      // Core has atomically frozen the submitted Cart and created an empty successor.
      // Clear the shared browser projection before leaving checkout so the header and
      // drawer cannot keep showing the submitted lines from cache.
      acceptCart(null);
      if (paymentResult.value.actionType === "REDIRECT" && paymentResult.value.redirectUrl) {
        window.sessionStorage.setItem(
          PAYMENT_ACTION_STORAGE_KEY,
          JSON.stringify(paymentResult.value),
        );
        setStatus("Payment is ready. Redirecting to the secure payment page…");
      } else if (paymentResult.value.actionType === "SDK" && paymentResult.value.clientToken) {
        window.sessionStorage.setItem(
          PAYMENT_ACTION_STORAGE_KEY,
          JSON.stringify(paymentResult.value),
        );
      }
      window.location.replace(paymentContinuationHref(continuation));
    } else {
      if (paymentResult.error?.code === "PRICE_CHANGED") {
        setPendingQuote(null);
        attemptKey.current = `checkout-${crypto.randomUUID()}`;
      }
      if (paymentResult.error?.code !== "PRICE_CHANGED" && pendingQuoteRef.current)
        scheduleQuoteRefresh(pendingQuoteRef.current);
      setStatus(paymentResult.error?.message ?? "Payments are unavailable right now.");
    }
  }
  const guest = cart?.id === "guest-cart";
  const canReview = Boolean(cart?.items.length && addressId && !guest && !cart?.checkoutBlocked);
  const selectedAddress = addresses.find((address) => address.id === addressId);
  const selectedFulfillmentOption = fulfillmentOptions.find(
    (option) => option.optionId === fulfillmentOptionId,
  );
  return (
    <>
      <div className="min-h-[100dvh] w-full bg-[var(--fm-background)]">
        <header className="border-b border-[var(--fm-border)] bg-white px-4 py-6 sm:px-6 lg:px-10">
          <Link
            href="/cart"
            className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--fm-primary-dark)] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to cart
          </Link>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="mt-1 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
                Review your order
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--fm-text-muted)]">
                Confirm where and when we should deliver. Your current total stays visible while you
                complete the details.
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-8 px-4 py-7 sm:px-6 lg:px-10 lg:py-10 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
          <main className="min-w-0">
            {guest ? (
              <div className="mb-5 border-b border-[var(--fm-warning-border)] pb-5">
                <p className="font-semibold">Sign in to continue with this saved cart.</p>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Your items stay saved while you sign in. Review current availability and delivery
                  before payment.
                </p>
                <Link
                  href="/auth/login?returnTo=/checkout"
                  className="mt-4 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white hover:bg-[#294f30]"
                >
                  Sign in to continue
                </Link>
              </div>
            ) : null}

            {showAddressEditor ? (
              <section
                aria-label="Address setup workspace"
                className="border-b border-[var(--fm-border)] pb-7"
              >
                <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] pb-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)]">
                      <MapPin className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-bold">
                        {editingAddress ? `Edit ${editingAddress.label}` : "Add delivery address"}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">
                        Your cart and order total remain available beside this guide.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAddress(undefined);
                      setShowAddressEditor(false);
                    }}
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm font-semibold transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Back to checkout</span>
                    <span className="sm:hidden">Back</span>
                  </button>
                </div>
                <div className="pt-6 lg:pt-8">
                  <AddressEditor
                    key={editingAddress?.id ?? "checkout-new-address"}
                    multiStep
                    browserApiKey={browserApiKey}
                    mapId={mapId}
                    initialAddress={editingAddress}
                    initialDestination={
                      editingAddress ? undefined : (carriedDestination.current ?? undefined)
                    }
                    defaultPhone={profile?.accountPhone ?? undefined}
                    savedPhoneNumbers={addresses.map((address) => address.phone)}
                    onConfirmed={async (confirmedAddressId) => {
                      if (!(await invalidatePendingQuote())) return;
                      await accountAddresses.invalidate();
                      await loadAddresses(confirmedAddressId);
                    }}
                  />
                </div>
              </section>
            ) : (
              <div className="grid gap-0">
                <section className="border-b border-[var(--fm-border)] pb-7">
                  <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] pb-5">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center text-[var(--fm-primary-dark)]">
                        {selectedAddress ? (
                          <CheckCircle2 className="size-5" aria-hidden="true" />
                        ) : (
                          <MapPin className="size-5" aria-hidden="true" />
                        )}
                      </span>
                      <div>
                        <h2 className="mt-1 text-xl font-bold">Where should we deliver?</h2>
                        <p className="mt-1 text-sm leading-6 text-[var(--fm-text-muted)]">
                          Choose a saved destination or confirm the details for Deliver to.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Add delivery address"
                      onClick={() => {
                        setEditingAddress(undefined);
                        setShowAddressEditor(true);
                      }}
                      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-3 text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Add address</span>
                      <span className="sm:hidden">Add</span>
                    </button>
                  </div>

                  {selectedAddress ? (
                    <div className="mt-5 flex items-start gap-3 border-y border-[var(--fm-border)] py-4">
                      <span className="grid size-9 shrink-0 place-items-center text-[var(--fm-primary-dark)]">
                        <MapPin className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold">{selectedAddress.label}</p>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--fm-success)]">
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            Confirmed
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-[var(--fm-text-muted)]">
                          {displayAddress(selectedAddress)}
                        </p>
                        <p className="mt-2 text-xs text-[var(--fm-text-muted)]">
                          {selectedAddress.recipient} · {selectedAddress.phone}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            aria-label={`Edit ${selectedAddress.label} address`}
                            onClick={() => {
                              setEditingAddress(selectedAddress);
                              setShowAddressEditor(true);
                            }}
                            className="text-xs font-bold text-[var(--fm-primary-dark)] underline underline-offset-4"
                          >
                            Edit details
                          </button>
                          <button
                            type="button"
                            aria-label="Change saved address"
                            onClick={() => setShowSavedAddresses((current) => !current)}
                            className="text-xs font-bold text-[var(--fm-primary-dark)] underline underline-offset-4"
                          >
                            {showSavedAddresses ? "Hide saved addresses" : "Choose another"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div
                    className={
                      selectedAddress && !showSavedAddresses && addressLoadState === "ready"
                        ? "pt-5"
                        : "pt-5 sm:pt-6"
                    }
                  >
                    {!selectedAddress || showSavedAddresses ? (
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fm-text-muted)]">
                        Saved addresses
                      </p>
                    ) : null}
                    {addressLoadState === "loading" ? (
                      <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                        Loading saved delivery addresses…
                      </p>
                    ) : addressLoadState === "error" ? (
                      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
                        <p>Saved addresses could not be loaded. Sign in or try again.</p>
                        <button
                          type="button"
                          onClick={() => void loadAddresses()}
                          className="mt-3 min-h-10 rounded-[var(--fm-radius-control)] border border-red-300 bg-white px-3 font-semibold transition-transform duration-150 active:scale-[0.97]"
                        >
                          Retry address load
                        </button>
                      </div>
                    ) : !selectedAddress || showSavedAddresses ? (
                      <AddressList
                        addresses={addresses}
                        defaultAddressId={profile?.defaultAddressId}
                        selectedAddressId={addressId}
                        onSelect={selectAddress}
                        onCorrect={(address) => {
                          setEditingAddress(address);
                          setShowAddressEditor(true);
                        }}
                        variant="flat"
                      />
                    ) : null}
                  </div>
                </section>

                <section className="border-b border-[var(--fm-border)] py-7">
                  <div className="flex items-start gap-3 border-b border-[var(--fm-border)] pb-5">
                    <span className="grid size-10 shrink-0 place-items-center text-[var(--fm-primary-dark)]">
                      <Truck className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fm-text-muted)]">
                        Delivery option
                      </p>
                      <h2 className="mt-1 text-xl font-bold">Choose when it arrives</h2>
                      <p className="mt-1 text-sm leading-6 text-[var(--fm-text-muted)]">
                        Lalamove confirms route availability and the current fee for this address.
                      </p>
                    </div>
                  </div>
                  {fulfillmentOptions.length ? (
                    <FulfillmentOptionPicker
                      options={fulfillmentOptions}
                      disabled={!canReview || quoteLoadState === "loading"}
                      selectedOptionId={fulfillmentOptionId}
                      loadingOptionId={
                        quoteLoadState === "loading" ? fulfillmentOptionId : undefined
                      }
                      quotedFee={
                        pendingQuote
                          ? {
                              optionId: pendingQuote.input.fulfillmentOptionId,
                              amountMinor: pendingQuote.deliverySubtotalMinor,
                              currency: pendingQuote.currency,
                            }
                          : undefined
                      }
                      onSelect={(option) => void reviewTotal(option)}
                    />
                  ) : (
                    <div className="mt-4 flex items-start gap-3 border-t border-[var(--fm-border)] pt-4 text-sm text-[var(--fm-text-muted)]">
                      <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <div role={fulfillmentLoadState === "error" ? "alert" : "status"}>
                        <p>
                          {!selectedAddress?.confirmedAt
                            ? "Select a confirmed address to load delivery options."
                            : fulfillmentLoadState === "loading"
                              ? "Loading delivery options…"
                              : fulfillmentLoadState === "error"
                                ? fulfillmentError
                                : guest
                                  ? "Sign in to load delivery options."
                                  : !cart?.items.length
                                    ? "Your cart must be loaded and contain items to check delivery."
                                    : "No delivery options are available for this address right now."}
                        </p>
                        {selectedAddress?.confirmedAt &&
                          !guest &&
                          fulfillmentLoadState !== "loading" && (
                            <button
                              type="button"
                              className="mt-2 min-h-11 font-semibold underline"
                              onClick={() => void retryDeliveryOptions()}
                            >
                              Retry delivery options
                            </button>
                          )}
                      </div>
                    </div>
                  )}
                  {quoteLoadState === "loading" ? (
                    <p
                      role="status"
                      className="mt-4 border-t border-[var(--fm-border)] pt-3 text-sm text-[var(--fm-text-muted)]"
                    >
                      Checking the Lalamove route and delivery fee…
                    </p>
                  ) : quoteError ? (
                    <div
                      role="alert"
                      className="mt-4 border-t border-red-200 pt-3 text-sm text-red-800"
                    >
                      <p>{quoteError}</p>
                      {selectedFulfillmentOption ? (
                        <button
                          type="button"
                          className="mt-2 min-h-11 font-semibold underline underline-offset-4"
                          onClick={() => void reviewTotal(selectedFulfillmentOption)}
                        >
                          Try quotation again
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <div>
                  <PromotionEntry
                    surface="flat"
                    codes={promotionCodes}
                    feedback={pendingQuote?.promotionFeedback ?? []}
                    disabled={guest || acceptingPayment}
                    onAdd={async (code) => {
                      if (!(await invalidatePendingQuote())) return false;
                      const next = [...promotionCodesRef.current, code];
                      promotionCodesRef.current = next;
                      setPromotionCodes(next);
                      checkoutDraft.save({
                        addressId: selectedAddressId.current,
                        promotionCodes: next,
                      });
                      setStatus(`${code} added. Review the total again to check the promotion.`);
                    }}
                    onRemove={async (code) => {
                      if (!(await invalidatePendingQuote())) return;
                      const next = promotionCodesRef.current.filter(
                        (currentCode) => currentCode !== code,
                      );
                      promotionCodesRef.current = next;
                      setPromotionCodes(next);
                      checkoutDraft.save({
                        addressId: selectedAddressId.current,
                        promotionCodes: next,
                      });
                      setStatus(`${code} removed. Review the total again.`);
                    }}
                  />
                </div>

                {pendingQuote ? (
                  <div>
                    <CheckoutTotalReview
                      quote={pendingQuote}
                      onAccept={confirmPayment}
                      accepting={acceptingPayment}
                      showAction={false}
                      surface="flat"
                    />
                    <button
                      type="button"
                      onClick={() => void discardPendingQuote()}
                      disabled={acceptingPayment}
                      className="mt-3 text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                    >
                      Discard current total and start again
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            {status ? (
              <p
                role="status"
                className="mt-5 flex items-start gap-2 border-t border-[var(--fm-border)] pt-4 text-sm"
              >
                <ShieldCheck
                  className="mt-0.5 size-4 shrink-0 text-[var(--fm-primary-dark)]"
                  aria-hidden="true"
                />
                {status}
              </p>
            ) : null}
          </main>

          <div className="xl:sticky xl:top-6">
            <OrderSummary
              cart={cart}
              totalMinor={pendingQuote?.totalMinor}
              quote={pendingQuote ?? undefined}
              surface="flat"
              actionLabel={
                guest
                  ? "Sign in to continue"
                  : cart?.checkoutBlocked
                    ? "Resolve unavailable items to continue"
                    : pendingQuote
                      ? "Accept total and continue to payment"
                      : quoteLoadState === "loading"
                        ? "Checking delivery fee…"
                        : quoteError && selectedFulfillmentOption
                          ? "Retry delivery quotation"
                          : addressId
                            ? "Choose a delivery option"
                            : "Select a delivery address"
              }
              actionHref={guest ? "/auth/login?returnTo=/checkout" : undefined}
              onAction={
                pendingQuote
                  ? confirmPayment
                  : selectedFulfillmentOption
                    ? () => void reviewTotal(selectedFulfillmentOption)
                    : undefined
              }
              disabled={
                guest
                  ? false
                  : acceptingPayment ||
                    quoteLoadState === "loading" ||
                    Boolean(cart?.checkoutBlocked) ||
                    (!pendingQuote && !selectedFulfillmentOption)
              }
              showItems
              onQuantityChange={(item, quantity) => void updateCartQuantity(item, quantity)}
              updatingSkuId={updatingSkuId}
            />
          </div>
        </div>
      </div>
    </>
  );
}

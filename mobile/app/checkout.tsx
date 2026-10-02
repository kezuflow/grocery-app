import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  CartView,
  CheckoutBootstrapView,
  CheckoutPaymentCompletionView,
  CheckoutQuoteView,
  FulfillmentOptionView,
  PaymentActionView,
} from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import {
  abandonCheckoutQuote,
  createCheckoutPayment,
  createCheckoutQuote,
  getCart,
  getCheckoutBootstrap,
  getCheckoutPaymentCompletion,
  getFulfillmentOptions,
} from "@/lib/commerce-api";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cart, setCart] = useState<CartView | null>(null);
  const [bootstrap, setBootstrap] = useState<CheckoutBootstrapView | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [options, setOptions] = useState<readonly FulfillmentOptionView[]>([]);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [quote, setQuote] = useState<CheckoutQuoteView | null>(null);
  const [payment, setPayment] = useState<PaymentActionView | null>(null);
  const [completion, setCompletion] = useState<CheckoutPaymentCompletionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCart, nextBootstrap] = await Promise.all([getCart(), getCheckoutBootstrap()]);
      setCart(nextCart);
      setBootstrap(nextBootstrap);
      setAddressId(
        (current) =>
          current ??
          nextBootstrap.addresses.find(
            (address) => address.status === "active" && address.serviceable,
          )?.id ??
          null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load checkout.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const address = bootstrap?.addresses.find((item) => item.id === addressId);
    if (!cart || !address || quote) return;
    let cancelled = false;
    setOptions([]);
    setOptionId(null);
    void getFulfillmentOptions(address.id, address.version, cart)
      .then((next) => {
        if (!cancelled) {
          setOptions(next);
          setOptionId(next.find((item) => item.eligible)?.optionId ?? null);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load delivery choices.");
      });
    return () => {
      cancelled = true;
    };
  }, [cart?.id, cart?.version, bootstrap, addressId, quote]);

  const refreshPayment = useCallback(async () => {
    if (!payment) return;
    try {
      setCompletion(await getCheckoutPaymentCompletion(payment.paymentIntentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh payment status.");
    }
  }, [payment]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPayment();
    });
    return () => subscription.remove();
  }, [refreshPayment]);

  async function review() {
    if (!cart || !addressId || !optionId) return;
    setWorking(true);
    setError(null);
    try {
      setQuote(await createCheckoutQuote(cart, addressId, optionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm your order total.");
    } finally {
      setWorking(false);
    }
  }

  async function changeDetails() {
    if (!quote || payment) return;
    setWorking(true);
    setError(null);
    try {
      await abandonCheckoutQuote(quote);
      setQuote(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not release this quote. Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function pay() {
    if (!quote) return;
    setWorking(true);
    setError(null);
    try {
      const next = await createCheckoutPayment(quote);
      setPayment(next);
      if (next.actionType === "REDIRECT" && next.redirectUrl)
        await Linking.openURL(next.redirectUrl);
      else if (next.actionType === "SDK")
        setError("This payment action is not available in the app yet.");
      else setCompletion(await getCheckoutPaymentCompletion(next.paymentIntentId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment setup could not be confirmed. Retry with the same order quote.",
      );
    } finally {
      setWorking(false);
    }
  }

  const selectedOption = options.find((item) => item.optionId === optionId);
  return (
    <View style={styles.screen}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.toolbarTitle}>Checkout</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {loading ? <ActivityIndicator color={palette.green} style={styles.loading} /> : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.retry}>Refresh checkout</Text>
            </Pressable>
          </View>
        ) : null}
        {cart && bootstrap ? (
          <>
            <Text style={styles.heading}>One more step</Text>
            <Text style={styles.description}>Check your delivery details before paying.</Text>
            <Text style={styles.sectionTitle}>Delivery address</Text>
            {bootstrap.addresses.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.empty}>Add a saved delivery address to continue.</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/address-new")}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Add address</Text>
                </Pressable>
              </View>
            ) : (
              bootstrap.addresses.map((address) => (
                <Pressable
                  key={address.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: addressId === address.id }}
                  disabled={!!quote || !!payment}
                  onPress={() => setAddressId(address.id)}
                  style={[styles.choice, addressId === address.id && styles.choiceSelected]}
                >
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceTitle}>{address.label}</Text>
                    <Text style={styles.choiceSub}>
                      {[
                        address.components.addressLine1,
                        address.components.barangay,
                        address.components.city,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                  </View>
                  <Text style={styles.radio}>{addressId === address.id ? "●" : "○"}</Text>
                </Pressable>
              ))
            )}
            {bootstrap.addresses.length > 0 && !quote ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/address-new")}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>Add another address</Text>
              </Pressable>
            ) : null}
            {addressId ? (
              <>
                <Text style={styles.sectionTitle}>Delivery</Text>
                {options.length === 0 ? (
                  <Text style={styles.empty}>Checking current delivery options…</Text>
                ) : (
                  options.map((option) => (
                    <Pressable
                      key={option.optionId}
                      accessibilityRole="button"
                      disabled={!option.eligible || !!quote || !!payment}
                      accessibilityState={{
                        selected: optionId === option.optionId,
                        disabled: !option.eligible,
                      }}
                      onPress={() => setOptionId(option.optionId)}
                      style={[
                        styles.choice,
                        optionId === option.optionId && styles.choiceSelected,
                        !option.eligible && styles.choiceDisabled,
                      ]}
                    >
                      <View style={styles.choiceCopy}>
                        <Text style={styles.choiceTitle}>
                          {option.mode === "INSTANT"
                            ? "Deliver as soon as possible"
                            : "Available delivery"}
                        </Text>
                        <Text style={styles.choiceSub}>
                          {option.eligible
                            ? option.deliveryPartner?.displayName ||
                              (option.mode === "INSTANT"
                                ? "Instant delivery"
                                : "Scheduled delivery")
                            : option.unavailableReason?.replaceAll("_", " ") || "Unavailable"}
                        </Text>
                        {option.deliveryWindow ? (
                          <Text style={styles.choiceSub}>
                            {new Date(option.deliveryWindow.startsAt).toLocaleString("en-PH", {
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.radio}>{optionId === option.optionId ? "●" : "○"}</Text>
                    </Pressable>
                  ))
                )}
              </>
            ) : null}
            <Text style={styles.sectionTitle}>Order summary</Text>
            <View style={styles.card}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{cart.items.length} items</Text>
                <Text style={styles.summaryValue}>
                  {money(quote?.merchandiseSubtotalMinor ?? cart.totalMinor, cart.currency)}
                </Text>
              </View>
              {quote ? (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Delivery</Text>
                    <Text style={styles.summaryValue}>
                      {money(quote.deliveryFeeMinor, quote.currency)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Discounts</Text>
                    <Text style={styles.summaryValue}>
                      −{money(quote.discountMinor, quote.currency)}
                    </Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total to pay</Text>
                    <Text style={styles.totalValue}>{money(quote.totalMinor, quote.currency)}</Text>
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>Final delivery fee and total appear after review.</Text>
              )}
            </View>
            {completion?.state === "COMPLETED" ? (
              <View style={styles.success}>
                <Text style={styles.successTitle}>Payment confirmed</Text>
                <Text style={styles.successCopy}>Your order is ready to follow in Orders.</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.replace("/(tabs)/orders")}
                  style={styles.primary}
                >
                  <Text style={styles.primaryText}>View orders</Text>
                </Pressable>
              </View>
            ) : payment ? (
              <View style={styles.card}>
                <Text style={styles.choiceTitle}>Waiting for payment confirmation</Text>
                <Text style={styles.choiceSub}>
                  {completion?.state.replaceAll("_", " ") ||
                    "Complete payment in the secure page, then return here."}
                </Text>
                {payment.actionType === "REDIRECT" && payment.redirectUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (payment.redirectUrl) void Linking.openURL(payment.redirectUrl);
                    }}
                    style={styles.secondary}
                  >
                    <Text style={styles.secondaryText}>Open secure payment page</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void refreshPayment()}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Refresh status</Text>
                </Pressable>
              </View>
            ) : quote ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={working}
                  onPress={() => void pay()}
                  style={[styles.primary, working && styles.disabled]}
                >
                  <Text style={styles.primaryText}>
                    {working
                      ? "Preparing payment…"
                      : `Pay ${money(quote.totalMinor, quote.currency)} securely`}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={working}
                  onPress={() => void changeDetails()}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Change delivery details</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={
                  working ||
                  !selectedOption?.eligible ||
                  cart.checkoutBlocked ||
                  cart.items.length === 0
                }
                onPress={() => void review()}
                style={[
                  styles.primary,
                  (working ||
                    !selectedOption?.eligible ||
                    cart.checkoutBlocked ||
                    cart.items.length === 0) &&
                    styles.disabled,
                ]}
              >
                <Text style={styles.primaryText}>
                  {working ? "Checking total…" : "Review total"}
                </Text>
              </Pressable>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  toolbar: {
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  back: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: palette.ink, fontSize: 33, lineHeight: 36, marginTop: -4 },
  toolbarTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  spacer: { width: 42 },
  content: { padding: 20 },
  loading: { marginTop: 30 },
  heading: { color: palette.ink, fontSize: 27, fontWeight: "800", letterSpacing: -0.6 },
  description: { color: palette.muted, fontSize: 14, marginTop: 7 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 25,
    marginBottom: 11,
  },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 20,
    padding: 18,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 18,
    padding: 16,
    marginBottom: 9,
  },
  choiceSelected: { borderColor: palette.green, backgroundColor: "#f2faf0" },
  choiceDisabled: { opacity: 0.5 },
  choiceCopy: { flex: 1 },
  choiceTitle: { color: palette.ink, fontSize: 14, fontWeight: "800" },
  choiceSub: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  radio: { color: palette.green, fontSize: 22, marginLeft: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  summaryLabel: { color: palette.muted, fontSize: 13 },
  summaryValue: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: 15,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  totalValue: { color: palette.ink, fontSize: 17, fontWeight: "800" },
  hint: { color: palette.muted, fontSize: 12, marginTop: 3 },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  primary: {
    height: 53,
    borderRadius: 16,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondary: {
    borderWidth: 1,
    borderColor: palette.green,
    borderRadius: 14,
    alignItems: "center",
    padding: 13,
    marginTop: 15,
  },
  secondaryText: { color: palette.green, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  errorCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16 },
  error: { color: "#b04335", fontSize: 13 },
  retry: { color: palette.green, fontWeight: "800", marginTop: 8 },
  success: { backgroundColor: "#e8f3e5", borderRadius: 20, padding: 18, marginTop: 20 },
  successTitle: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  successCopy: { color: palette.ink, fontSize: 13, marginTop: 5 },
});

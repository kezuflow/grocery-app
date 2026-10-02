import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CartView, PopularWithCartProductView } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { authClient } from "@/lib/auth-client";
import {
  CommerceError,
  getCart,
  getPopularWithCart,
  selectCartLocation,
  setCartItem,
} from "@/lib/commerce-api";
import { useLocation } from "@/lib/location-context";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

export default function CartScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { location } = useLocation();
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(false);
  const [workingSku, setWorkingSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsCartLocation, setNeedsCartLocation] = useState(false);
  const [popular, setPopular] = useState<readonly PopularWithCartProductView[]>([]);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    setError(null);
    try {
      setCart(await getCart());
      setNeedsCartLocation(false);
    } catch (cause) {
      setCart(null);
      if (cause instanceof CommerceError && cause.code === "DELIVERY_LOCATION_REQUIRED")
        setNeedsCartLocation(true);
      else setError(cause instanceof Error ? cause.message : "Could not load your cart.");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (!cart?.items.length) {
      setPopular([]);
      return;
    }
    let active = true;
    void getPopularWithCart()
      .then((items) => {
        if (active) setPopular(items);
      })
      .catch(() => {
        if (active) setPopular([]);
      });
    return () => {
      active = false;
    };
  }, [cart?.version, cart?.items.length]);

  async function startCart() {
    if (!location) {
      router.push("/location");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await selectCartLocation(location.coordinate, 0);
      setCart(result.cart);
      setNeedsCartLocation(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not select this address.");
    } finally {
      setLoading(false);
    }
  }

  async function changeQuantity(skuId: string, quantity: number) {
    if (!cart) return;
    setWorkingSku(skuId);
    setError(null);
    try {
      setCart(await setCartItem(cart, skuId, quantity));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your cart.");
      if (cause instanceof CommerceError && cause.code === "CART_VERSION_CONFLICT") void load();
    } finally {
      setWorkingSku(null);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Your cart</Text>
      {isPending || loading ? (
        <ActivityIndicator color={palette.green} style={styles.loading} />
      ) : !session?.user ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sign in to start your cart</Text>
          <Text style={styles.emptyCopy}>Your cart stays with your FreshMarkets account.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/auth")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
        </View>
      ) : needsCartLocation ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Choose a delivery address</Text>
          <Text style={styles.emptyCopy}>We’ll show the items available near you.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void startCart()}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>
              {location ? "Use selected address" : "Choose address"}
            </Text>
          </Pressable>
        </View>
      ) : cart && cart.items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyCopy}>Add fresh picks from the market.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(tabs)/search")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Explore products</Text>
          </Pressable>
        </View>
      ) : cart ? (
        <>
          <View style={styles.addressCard}>
            <Text style={styles.eyebrow}>DELIVERING TO</Text>
            <Text style={styles.address}>
              {location?.displayAddress || "Your saved delivery area"}
            </Text>
          </View>
          {cart.items.map((item) => (
            <View key={item.skuId} style={styles.line}>
              <View style={styles.lineTop}>
                <Text style={styles.lineName}>{item.name}</Text>
                <Text style={styles.linePrice}>
                  {item.lineTotalMinor === null
                    ? "Price unavailable"
                    : money(item.lineTotalMinor, cart.currency)}
                </Text>
              </View>
              {item.availability !== "AVAILABLE" ? (
                <Text style={styles.unavailable}>Currently unavailable</Text>
              ) : null}
              <View style={styles.quantity}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove one ${item.name}`}
                  disabled={workingSku !== null}
                  onPress={() => void changeQuantity(item.skuId, Math.max(0, item.quantity - 1))}
                  style={styles.quantityButton}
                >
                  <Text style={styles.quantityText}>−</Text>
                </Pressable>
                <Text style={styles.quantityValue}>
                  {workingSku === item.skuId ? "…" : item.quantity}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add one ${item.name}`}
                  disabled={workingSku !== null}
                  onPress={() => void changeQuantity(item.skuId, item.quantity + 1)}
                  style={styles.quantityButton}
                >
                  <Text style={styles.quantityText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {popular.length ? (
            <View style={styles.popularSection}>
              <Text style={styles.popularTitle}>Popular with your order</Text>
              <Text style={styles.popularCopy}>Products often bought with these picks.</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.popularItems}
              >
                {popular.map((item) => (
                  <Pressable
                    key={item.productId}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${item.name}`}
                    onPress={() =>
                      router.push({ pathname: "/product/[slug]", params: { slug: item.slug } })
                    }
                    style={styles.popularCard}
                  >
                    <View style={styles.popularImage}>
                      <Text style={styles.popularFlower}>✳</Text>
                    </View>
                    <Text numberOfLines={2} style={styles.popularName}>
                      {item.name}
                    </Text>
                    <Text style={styles.popularAction}>View product ›</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{money(cart.totalMinor, cart.currency)}</Text>
            </View>
            <Text style={styles.summaryHint}>
              Delivery fees and discounts are confirmed at checkout.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={cart.checkoutBlocked || cart.paymentInProgress}
            onPress={() => router.push("/checkout")}
            style={[
              styles.primary,
              (cart.checkoutBlocked || cart.paymentInProgress) && styles.disabled,
            ]}
          >
            <Text style={styles.primaryText}>Continue to checkout</Text>
          </Pressable>
          {cart.checkoutBlocked ? (
            <Text style={styles.unavailable}>Review unavailable items before checkout.</Text>
          ) : null}
        </>
      ) : null}
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.retry}>Refresh cart</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, paddingTop: 30, paddingBottom: 36 },
  heading: {
    color: palette.ink,
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginBottom: 22,
  },
  loading: { marginTop: 40 },
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 22,
  },
  emptyTitle: { color: palette.ink, fontSize: 21, fontWeight: "800" },
  emptyCopy: { color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  primary: {
    backgroundColor: palette.green,
    borderRadius: 15,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  disabled: { opacity: 0.5 },
  addressCard: { backgroundColor: "#e8f3e5", borderRadius: 18, padding: 17, marginBottom: 15 },
  eyebrow: { color: palette.green, fontSize: 10, letterSpacing: 1.1, fontWeight: "800" },
  address: { color: palette.ink, fontSize: 14, fontWeight: "700", marginTop: 5 },
  line: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    marginBottom: 10,
  },
  popularSection: { marginTop: 18, marginBottom: 12 },
  popularTitle: { color: palette.ink, fontSize: 19, fontWeight: "800" },
  popularCopy: { color: palette.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  popularItems: { gap: 10 },
  popularCard: {
    width: 145,
    backgroundColor: "#fff",
    borderRadius: 18,
    borderColor: palette.line,
    borderWidth: 1,
    padding: 10,
  },
  popularImage: {
    height: 78,
    borderRadius: 12,
    backgroundColor: "#eef5e9",
    justifyContent: "center",
    alignItems: "center",
  },
  popularFlower: { color: "#94b996", fontSize: 32 },
  popularName: { color: palette.ink, fontSize: 13, fontWeight: "700", minHeight: 34, marginTop: 9 },
  popularAction: { color: palette.green, fontSize: 11, fontWeight: "800", marginTop: 6 },
  lineTop: { flexDirection: "row", gap: 10 },
  lineName: { flex: 1, color: palette.ink, fontSize: 15, fontWeight: "700" },
  linePrice: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  unavailable: { color: "#b04335", fontSize: 12, marginTop: 8 },
  quantity: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    alignSelf: "flex-end",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
  },
  quantityButton: { width: 37, height: 36, justifyContent: "center", alignItems: "center" },
  quantityText: { color: palette.green, fontSize: 20, fontWeight: "700" },
  quantityValue: { minWidth: 26, textAlign: "center", color: palette.ink, fontWeight: "700" },
  summary: { backgroundColor: "#fff", borderRadius: 18, padding: 18, marginTop: 7 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  summaryValue: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  summaryHint: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  errorCard: { marginTop: 16, padding: 14, backgroundColor: "#fff", borderRadius: 14 },
  error: { color: "#b04335", fontSize: 13 },
  retry: { color: palette.green, fontWeight: "800", fontSize: 13, marginTop: 8 },
});

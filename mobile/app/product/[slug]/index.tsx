import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MarketplaceProductView, MarketplaceSearchView } from "@freshmarkets/contracts";
import { ProductCard } from "@/components/product-card";
import { palette } from "@/constants/palette";
import { getProduct, searchCatalog } from "@/lib/catalog-api";
import { authClient } from "@/lib/auth-client";
import {
  CommerceError,
  getCart,
  getFavorites,
  selectCartLocation,
  setCartItem,
  setFavorite,
} from "@/lib/commerce-api";
import { useLocation } from "@/lib/location-context";

const marketplaceOrigin = process.env.EXPO_PUBLIC_MARKETPLACE_ORIGIN ?? "https://freshmarkets.ph";

function mediaUrl(src: string): string | null {
  if (!marketplaceOrigin) return null;
  try {
    return new URL(src, marketplaceOrigin).toString();
  } catch {
    return null;
  }
}

export default function ProductScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { location, ready } = useLocation();
  const { data: session } = authClient.useSession();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [view, setView] = useState<MarketplaceProductView | null>(null);
  const [related, setRelated] = useState<MarketplaceSearchView | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [favoriteReady, setFavoriteReady] = useState(false);
  const [favoriteRetry, setFavoriteRetry] = useState(0);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getProduct(slug);
      setView(next);
      setSelectedVariant(next?.product.variants[0]?.id ?? null);
      if (next) {
        const matches = await searchCatalog("", next.product.category.slug).catch(() => null);
        setRelated(matches);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Product is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [slug, location?.browsingContextToken]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const product = view?.product;
  const chosen = product?.variants.find((item) => item.id === selectedVariant);

  useEffect(() => {
    if (!session?.user || !product) {
      setSaved(false);
      setFavoriteReady(!!product);
      return;
    }
    let active = true;
    setFavoriteReady(false);
    void getFavorites()
      .then((items) => {
        if (active) {
          setSaved(items.some((item) => item.productId === product.id));
          setFavoriteReady(true);
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Could not load favorite status.");
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, product?.id, favoriteRetry]);

  async function toggleSaved() {
    if (!product || !favoriteReady) return;
    if (!session?.user) {
      router.push("/auth");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await setFavorite(product.id, !saved);
      setSaved(result.saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update favorite.");
    } finally {
      setSaving(false);
    }
  }

  async function addToCart() {
    if (!location) {
      router.push("/location");
      return;
    }
    if (!session?.user) {
      router.push("/auth");
      return;
    }
    if (!chosen || chosen.availability !== "AVAILABLE") return;
    setAdding(true);
    setError(null);
    try {
      let cart;
      try {
        cart = await getCart();
      } catch (cause) {
        if (!(cause instanceof CommerceError) || cause.code !== "DELIVERY_LOCATION_REQUIRED")
          throw cause;
        cart = (await selectCartLocation(location.coordinate, 0)).cart;
      }
      const selectedLocationId = location.serviceability.fulfillmentLocation?.id;
      if (cart.locationId && selectedLocationId && cart.locationId !== selectedLocationId)
        throw new Error(
          "Your cart is set to another delivery area. Review its address before adding this item.",
        );
      const previous = cart.items.find((item) => item.skuId === chosen.id)?.quantity ?? 0;
      await setCartItem(cart, chosen.id, previous + 1);
      router.push("/(tabs)/cart");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this item.");
    } finally {
      setAdding(false);
    }
  }
  return (
    <View style={styles.screen}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.toolbarTitle} numberOfLines={1}>
          Product details
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? "Remove from favorites" : "Save to favorites"}
          accessibilityState={{ selected: saved, disabled: saving || !product || !favoriteReady }}
          disabled={saving || !product || !favoriteReady}
          onPress={() => void toggleSaved()}
          style={styles.favoriteButton}
        >
          <Text style={styles.favoriteIcon}>{saved ? "♥" : "♡"}</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator
          color={palette.green}
          style={styles.status}
          accessibilityLabel="Loading product"
        />
      ) : null}
      {error ? (
        <View style={styles.status}>
          <Text style={styles.error}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFavoriteRetry((value) => value + 1);
              void load();
            }}
          >
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && !product ? (
        <Text style={styles.status}>This product is no longer available.</Text>
      ) : null}
      {product ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.gallery}
          >
            {(view.images.length ? view.images : product.media ? [product.media] : []).map(
              (media, index) => {
                const url = mediaUrl(media.src);
                return url ? (
                  <Image
                    key={`${media.src}-${index}`}
                    source={{ uri: url }}
                    style={[styles.heroImage, { width }]}
                    accessibilityLabel={media.alt || product.name}
                  />
                ) : (
                  <View key={`${media.src}-${index}`} style={[styles.heroImage, { width }]}>
                    <Text style={styles.heroPlaceholder}>✳</Text>
                  </View>
                );
              },
            )}
            {!view.images.length && !product.media ? (
              <View style={[styles.heroImage, { width }]}>
                <Text style={styles.heroPlaceholder}>✳</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.body}>
            <Text style={styles.category}>{product.category.name}</Text>
            <Text style={styles.name}>{product.name}</Text>
            {location ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/location")}
                style={styles.addressPrompt}
              >
                <Text style={styles.addressPromptText}>
                  ⌖ Choose a delivery address to see local prices
                </Text>
                <Text style={styles.addressPromptArrow}>›</Text>
              </Pressable>
            )}
            {product.variants.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Choose a size</Text>
                <View style={styles.variants}>
                  {product.variants.map((variant) => (
                    <Pressable
                      key={variant.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedVariant === variant.id }}
                      onPress={() => setSelectedVariant(variant.id)}
                      style={[
                        styles.variant,
                        selectedVariant === variant.id && styles.variantSelected,
                      ]}
                    >
                      <Text style={styles.variantName}>
                        {variant.merchandisingLabel || variant.name}
                      </Text>
                      <Text style={styles.variantUnit}>{variant.unit}</Text>
                      {variant.priceMinor !== null && variant.currency ? (
                        <Text style={styles.variantPrice}>
                          {new Intl.NumberFormat("en-PH", {
                            style: "currency",
                            currency: variant.currency,
                          }).format((variant.sale?.priceMinor ?? variant.priceMinor) / 100)}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {product.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>About this product</Text>
                <Text style={styles.copy}>{product.description}</Text>
              </View>
            ) : null}
            {product.details.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Product information</Text>
                {product.details.map((detail) => (
                  <View key={`${detail.label}-${detail.sortOrder}`} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{detail.label}</Text>
                    <Text style={styles.detailValue}>{detail.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {related?.page.items.some((item) => item.id !== product.id) ? (
            <View style={styles.related}>
              <Text style={styles.sectionTitle}>More from {product.category.name}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.relatedItems}
              >
                {related.page.items
                  .filter((item) => item.id !== product.id)
                  .slice(0, 8)
                  .map((item) => (
                    <ProductCard key={item.id} product={item} />
                  ))}
              </ScrollView>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
      {product ? (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            accessibilityRole="button"
            disabled={adding || !chosen || (!!location && chosen.availability !== "AVAILABLE")}
            onPress={() => void addToCart()}
            style={[
              styles.addButton,
              (adding || !chosen || (!!location && chosen.availability !== "AVAILABLE")) &&
                styles.addDisabled,
            ]}
          >
            <Text style={styles.addText}>
              {adding
                ? "Adding…"
                : !location
                  ? "Choose address"
                  : !session?.user
                    ? "Sign in to add"
                    : chosen?.availability !== "AVAILABLE"
                      ? "Currently unavailable"
                      : "Add to cart"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  toolbar: {
    minHeight: 62,
    paddingHorizontal: 18,
    paddingBottom: 8,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: palette.ink, fontSize: 33, lineHeight: 36, marginTop: -4 },
  toolbarTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  toolbarSpacer: { width: 42 },
  favoriteButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  favoriteIcon: { color: palette.green, fontSize: 29, lineHeight: 34 },
  status: { margin: 24, color: palette.muted },
  error: { color: palette.ink, marginBottom: 12 },
  retry: { color: palette.green, fontWeight: "700" },
  content: { paddingBottom: 32 },
  bottomBar: {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  addButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
  },
  addDisabled: { opacity: 0.55 },
  addText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  gallery: { backgroundColor: "#eef5e9" },
  heroImage: {
    height: 306,
    resizeMode: "contain",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5e9",
  },
  heroPlaceholder: { color: "#94b996", fontSize: 84 },
  body: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -18,
    padding: 22,
    paddingBottom: 10,
  },
  category: {
    color: palette.green,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontSize: 11,
    fontWeight: "800",
  },
  name: { color: palette.ink, fontSize: 27, lineHeight: 32, fontWeight: "800", marginTop: 8 },
  locationNote: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 12 },
  addressPrompt: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#eff7ed",
    borderRadius: 16,
    padding: 15,
    marginTop: 18,
  },
  addressPromptText: { color: palette.green, fontSize: 13, fontWeight: "700", flex: 1 },
  addressPromptArrow: { color: palette.green, fontSize: 22 },
  section: { marginTop: 28 },
  sectionTitle: { color: palette.ink, fontSize: 19, fontWeight: "800", marginBottom: 14 },
  variants: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  variant: {
    minWidth: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 13,
    backgroundColor: "#fff",
  },
  variantSelected: { borderColor: palette.green, backgroundColor: "#eff7ed" },
  variantName: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  variantUnit: { color: palette.muted, fontSize: 12, marginTop: 5 },
  variantPrice: { color: palette.green, fontSize: 14, fontWeight: "800", marginTop: 8 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 22 },
  detailRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: palette.line,
    flexDirection: "row",
    gap: 16,
  },
  detailLabel: { color: palette.ink, fontSize: 13, fontWeight: "700", flex: 1 },
  detailValue: { color: palette.muted, fontSize: 13, flex: 2 },
  related: { marginTop: 26, paddingLeft: 20 },
  relatedItems: { gap: 12, paddingRight: 20 },
});

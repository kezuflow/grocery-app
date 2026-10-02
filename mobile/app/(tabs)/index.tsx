import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MarketplaceHomeView } from "@freshmarkets/contracts";
import { getHome } from "@/lib/catalog-api";
import { ProductCard } from "@/components/product-card";
import { palette } from "@/constants/palette";
import { useLocation } from "@/lib/location-context";

export default function HomeScreen() {
  const router = useRouter();
  const { location, ready } = useLocation();
  const [home, setHome] = useState<MarketplaceHomeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHome(await getHome());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [location?.browsingContextToken]);
  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topline}>
        <Text style={styles.wordmark}>freshmarkets</Text>
        <Text style={styles.flower}>✳</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          location
            ? `Change delivery address, ${location.displayAddress}`
            : "Choose delivery address"
        }
        onPress={() => router.push("/location")}
        style={styles.locationBar}
      >
        <Text style={styles.locationIcon}>⌖</Text>
        <View style={styles.locationCopy}>
          <Text style={styles.locationLabel}>DELIVER TO</Text>
          <Text style={styles.locationValue} numberOfLines={1}>
            {location?.displayAddress ?? "Choose your address"}
          </Text>
        </View>
        <Text style={styles.locationChevron}>›</Text>
      </Pressable>
      <Text style={styles.eyebrow}>FRESH PICKS FOR YOU</Text>
      <Text style={styles.heading}>Your market, at your fingertips.</Text>
      <Text style={styles.supporting}>Browse fresh food and daily essentials.</Text>
      {home && home.categories.length > 0 && (
        <View style={styles.categoriesSection}>
          <Text style={styles.sectionTitle}>Shop by category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categories}
          >
            {home.categories.map((category) => (
              <Pressable
                key={category.code}
                accessibilityRole="button"
                accessibilityLabel={`Browse ${category.name}`}
                onPress={() =>
                  router.push({ pathname: "/(tabs)/search", params: { category: category.slug } })
                }
                style={({ pressed }) => [styles.category, pressed && styles.pressed]}
              >
                <Text style={styles.categoryFlower}>✳</Text>
                <Text style={styles.categoryName} numberOfLines={2}>
                  {category.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {loading && (
        <ActivityIndicator
          color={palette.green}
          style={styles.status}
          accessibilityLabel="Loading catalog"
        />
      )}
      {error && (
        <View style={styles.status}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      )}
      {!loading && !error && home?.rails.length === 0 && (
        <Text style={styles.status}>Fresh picks will appear here soon.</Text>
      )}
      {home?.rails.map((rail) => (
        <View key={rail.code} style={styles.rail}>
          <View style={styles.railHeading}>
            <Text style={styles.railTitle}>{rail.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View all ${rail.title}`}
              onPress={() =>
                router.push({ pathname: "/(tabs)/search", params: { category: rail.categorySlug } })
              }
            >
              <Text style={styles.viewAll}>View all</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.products}
          >
            {rail.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { paddingBottom: 32 },
  topline: {
    height: 70,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { color: palette.green, fontSize: 22, fontWeight: "800", letterSpacing: -1 },
  flower: { color: palette.green, fontSize: 25 },
  locationBar: {
    minHeight: 60,
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationIcon: { color: palette.green, fontSize: 24 },
  locationCopy: { flex: 1 },
  locationLabel: { color: palette.muted, fontSize: 9, letterSpacing: 1, fontWeight: "800" },
  locationValue: { color: palette.ink, fontSize: 13, fontWeight: "700", marginTop: 3 },
  locationChevron: { color: palette.green, fontSize: 26 },
  eyebrow: {
    color: palette.green,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 1.5,
    marginTop: 29,
    marginHorizontal: 20,
  },
  heading: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 36,
    letterSpacing: -1,
    marginTop: 8,
    marginHorizontal: 20,
    maxWidth: 330,
  },
  supporting: { color: palette.muted, fontSize: 14, marginTop: 10, marginHorizontal: 20 },
  categoriesSection: { marginTop: 28 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 21,
    fontWeight: "800",
    marginHorizontal: 20,
    marginBottom: 14,
  },
  categories: { paddingHorizontal: 20, gap: 10 },
  category: {
    width: 104,
    minHeight: 104,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    padding: 12,
    justifyContent: "space-between",
  },
  categoryFlower: { color: palette.green, fontSize: 25 },
  categoryName: { color: palette.ink, fontSize: 13, fontWeight: "700", lineHeight: 17 },
  pressed: { opacity: 0.7 },
  status: { margin: 24, alignItems: "flex-start" },
  error: { color: palette.ink, marginBottom: 12 },
  retry: { color: palette.green, fontWeight: "700" },
  rail: { marginTop: 28 },
  railHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 14,
  },
  railTitle: {
    color: palette.ink,
    fontSize: 21,
    fontWeight: "800",
  },
  viewAll: { color: palette.green, fontSize: 13, fontWeight: "700" },
  products: { paddingHorizontal: 20, gap: 12 },
});

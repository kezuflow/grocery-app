import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MarketplaceHomeView } from "@freshmarkets/contracts";
import { getHome } from "@/lib/catalog-api";
import { ProductCard } from "@/components/product-card";
import { palette } from "@/constants/palette";

export default function HomeScreen() {
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
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topline}>
        <Text style={styles.wordmark}>freshmarkets</Text>
        <Text style={styles.flower}>✳</Text>
      </View>
      <Text style={styles.eyebrow}>FRESH PICKS FOR YOU</Text>
      <Text style={styles.heading}>Your market, at your fingertips.</Text>
      <Text style={styles.supporting}>Browse fresh food and daily essentials.</Text>
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
          <Text style={styles.railTitle}>{rail.title}</Text>
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
  status: { margin: 24, alignItems: "flex-start" },
  error: { color: palette.ink, marginBottom: 12 },
  retry: { color: palette.green, fontWeight: "700" },
  rail: { marginTop: 28 },
  railTitle: {
    color: palette.ink,
    fontSize: 21,
    fontWeight: "800",
    marginHorizontal: 20,
    marginBottom: 14,
  },
  products: { paddingHorizontal: 20, gap: 12 },
});

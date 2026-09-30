import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MarketplaceSearchView } from "@freshmarkets/contracts";
import { searchCatalog } from "@/lib/catalog-api";
import { ProductCard } from "@/components/product-card";
import { palette } from "@/constants/palette";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketplaceSearchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const search = useCallback(async (value: string, cancelled: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const next = await searchCatalog(value);
      if (!cancelled()) setResults(next);
    } catch (cause) {
      if (!cancelled()) setError(cause instanceof Error ? cause.message : "Search is unavailable.");
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(() => void search(query.trim(), () => disposed), 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Search the market</Text>
      <TextInput
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setResults(null);
          setLoading(true);
        }}
        placeholder="Search produce and essentials"
        placeholderTextColor="#8a968c"
        style={styles.input}
        returnKeyType="search"
        accessibilityLabel="Search products"
        maxLength={120}
      />
      {loading && (
        <ActivityIndicator
          color={palette.green}
          style={styles.status}
          accessibilityLabel="Searching catalog"
        />
      )}
      {error && (
        <View style={styles.status}>
          <Text style={styles.message}>{error}</Text>
          <Pressable
            onPress={() => void search(query.trim(), () => false)}
            accessibilityRole="button"
          >
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      )}
      {!loading && !error && results?.page.items.length === 0 && (
        <Text style={styles.status}>
          {query ? "No matching products." : "No products available yet."}
        </Text>
      )}
      {!error && (
        <FlatList
          data={results?.page.items ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ProductCard product={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, paddingHorizontal: 20, paddingTop: 30 },
  heading: {
    color: palette.ink,
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginBottom: 18,
  },
  input: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 14,
    height: 50,
    paddingHorizontal: 16,
    color: palette.ink,
    fontSize: 15,
  },
  status: { marginTop: 25, color: palette.muted },
  message: { color: palette.ink, marginBottom: 12 },
  retry: { color: palette.green, fontWeight: "700" },
  list: { paddingTop: 20, paddingBottom: 30 },
  row: { gap: 12, marginBottom: 12 },
});

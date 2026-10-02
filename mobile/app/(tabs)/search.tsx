import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type { MarketplaceSearchView } from "@freshmarkets/contracts";
import { searchCatalog } from "@/lib/catalog-api";
import { ProductCard } from "@/components/product-card";
import { palette } from "@/constants/palette";
import { useLocation } from "@/lib/location-context";

export default function SearchScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { location, ready } = useLocation();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketplaceSearchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useCallback(
    async (value: string, categorySlug: string | undefined, cancelled: () => boolean) => {
      setLoading(true);
      setError(null);
      setMoreError(null);
      setResults(null);
      try {
        const next = await searchCatalog(value, categorySlug);
        if (!cancelled()) setResults(next);
      } catch (cause) {
        if (!cancelled())
          setError(cause instanceof Error ? cause.message : "Search is unavailable.");
      } finally {
        if (!cancelled()) setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(() => {
      if (ready) void search(query.trim(), category, () => disposed);
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [query, category, location?.browsingContextToken, ready, search]);

  const activeCategory = results?.categories.find((item) => item.slug === category);

  const loadMore = useCallback(
    async (retry = false) => {
      const cursor = results?.page.nextCursor;
      if (!cursor || loading || loadingMore || error || (moreError && !retry)) return;
      setLoadingMore(true);
      setMoreError(null);
      try {
        const next = await searchCatalog(query.trim(), category, cursor);
        setResults((current) =>
          current?.page.nextCursor === cursor
            ? {
                ...current,
                page: {
                  items: [...current.page.items, ...next.page.items],
                  nextCursor: next.page.nextCursor,
                },
              }
            : current,
        );
      } catch (cause) {
        setMoreError(cause instanceof Error ? cause.message : "More products could not be loaded.");
      } finally {
        setLoadingMore(false);
      }
    },
    [results, loading, loadingMore, error, moreError, query, category],
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{activeCategory?.name ?? "Search the market"}</Text>
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
      {results && results.categories.length > 0 && (
        <FlatList
          horizontal
          data={[{ code: "all", name: "All", slug: "" }, ...results.categories]}
          keyExtractor={(item) => item.code}
          showsHorizontalScrollIndicator={false}
          style={styles.filters}
          contentContainerStyle={styles.filtersContent}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: (category ?? "") === item.slug }}
              onPress={() => router.setParams({ category: item.slug || undefined })}
              style={[styles.filter, (category ?? "") === item.slug && styles.filterActive]}
            >
              <Text
                style={[
                  styles.filterText,
                  (category ?? "") === item.slug && styles.filterTextActive,
                ]}
              >
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}
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
            onPress={() => void search(query.trim(), category, () => false)}
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
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={palette.green} />
            ) : moreError ? (
              <Pressable onPress={() => void loadMore(true)} accessibilityRole="button">
                <Text style={styles.retry}>Could not load more. Tap to retry.</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => <ProductCard product={item} width={(width - 52) / 2} />}
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
    flexShrink: 0,
    paddingHorizontal: 16,
    color: palette.ink,
    fontSize: 15,
  },
  filters: { flexGrow: 0, flexShrink: 0, height: 50, marginTop: 16 },
  filtersContent: { gap: 8, paddingRight: 20 },
  filter: {
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 999,
  },
  filterActive: { borderColor: palette.green, backgroundColor: palette.green },
  filterText: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: "#fff" },
  status: { marginTop: 25, color: palette.muted },
  message: { color: palette.ink, marginBottom: 12 },
  retry: { color: palette.green, fontWeight: "700" },
  list: { paddingTop: 20, paddingBottom: 30 },
  row: { gap: 12, marginBottom: 12 },
});

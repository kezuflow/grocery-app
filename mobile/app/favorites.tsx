import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SavedProductView } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { authClient } from "@/lib/auth-client";
import { getFavorites, setFavorite } from "@/lib/commerce-api";

export default function FavoritesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();
  const [items, setItems] = useState<readonly SavedProductView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await getFavorites());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load favorites.");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function remove(productId: string) {
    setError(null);
    try {
      await setFavorite(productId, false);
      setItems((current) => current.filter((item) => item.productId !== productId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove favorite.");
    }
  }
  return (
    <View style={styles.screen}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.toolbarTitle}>Saved favorites</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Your fresh picks</Text>
        <Text style={styles.subtitle}>Keep the products you want close at hand.</Text>
        {!session?.user ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/auth")}
            style={styles.card}
          >
            <Text style={styles.name}>Sign in to save favorites</Text>
            <Text style={styles.action}>Sign in ›</Text>
          </Pressable>
        ) : null}
        {loading ? <ActivityIndicator color={palette.green} style={styles.loading} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && session?.user && !items.length ? (
          <View style={styles.card}>
            <Text style={styles.name}>No favorites yet</Text>
            <Text style={styles.subtitle}>Tap the heart on a product you like.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/search")}>
              <Text style={styles.action}>Explore products ›</Text>
            </Pressable>
          </View>
        ) : null}
        {items.map((item) => (
          <View key={item.productId} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${item.name}`}
              onPress={() =>
                router.push({ pathname: "/product/[slug]", params: { slug: item.slug } })
              }
              style={styles.itemCopy}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.action}>View product ›</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name} from favorites`}
              onPress={() => void remove(item.productId)}
            >
              <Text style={styles.heart}>♥</Text>
            </Pressable>
          </View>
        ))}
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
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  back: { color: palette.ink, fontSize: 33, width: 40 },
  toolbarTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  spacer: { width: 40 },
  content: { padding: 20 },
  heading: { color: palette.ink, fontSize: 28, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 19,
    borderColor: palette.line,
    borderWidth: 1,
    padding: 17,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  itemCopy: { flex: 1 },
  name: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  action: { color: palette.green, fontSize: 13, fontWeight: "800", marginTop: 7 },
  heart: { color: palette.green, fontSize: 27, paddingHorizontal: 8 },
  loading: { marginTop: 20 },
  error: { color: "#b04335", fontSize: 13, marginTop: 14 },
});

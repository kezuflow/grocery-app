import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { CustomerOrderView, CustomerOrdersPage } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { authClient } from "@/lib/auth-client";
import { getOrders } from "@/lib/commerce-api";

const filters = ["all", "active", "completed"] as const;

export default function OrdersScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [page, setPage] = useState<CustomerOrdersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    setError(null);
    try {
      setPage(await getOrders(filter));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function loadMore() {
    if (!page?.nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const next = await getOrders(filter, page.nextCursor);
      setPage((current) =>
        current?.nextCursor === page.nextCursor
          ? {
              items: [...current.items, ...next.items],
              nextCursor: next.nextCursor,
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more orders.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Your orders</Text>
      {isPending ? (
        <ActivityIndicator color={palette.green} />
      ) : !session?.user ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sign in to see your orders</Text>
          <Text style={styles.emptyCopy}>Track deliveries and revisit past purchases.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/auth")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.filters}>
            {filters.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === item }}
                onPress={() => setFilter(item)}
                style={[styles.filter, filter === item && styles.filterActive]}
              >
                <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
                  {item[0].toUpperCase() + item.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          {loading ? <ActivityIndicator color={palette.green} style={styles.loading} /> : null}
          {error ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.errorCard}
            >
              <Text style={styles.error}>{error}</Text>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          ) : null}
          {!loading && !error && page?.items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No orders here yet</Text>
              <Text style={styles.emptyCopy}>
                Once you place an order, its progress will appear here.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(tabs)/search")}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Explore products</Text>
              </Pressable>
            </View>
          ) : null}
          <FlatList
            data={page?.items ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={palette.green} /> : null}
            renderItem={({ item }) => (
              <OrderCard
                order={item}
                onPress={() =>
                  router.push({ pathname: "/order-detail", params: { orderId: item.id } })
                }
              />
            )}
          />
        </>
      )}
    </View>
  );
}

function OrderCard({ order, onPress }: { order: CustomerOrderView; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}
    >
      <View style={styles.orderTop}>
        <Text style={styles.orderNumber}>Order {order.orderNumber}</Text>
        <Text style={styles.arrow}>›</Text>
      </View>
      <Text style={styles.orderStatus}>{order.status.replaceAll("_", " ")}</Text>
      <Text style={styles.orderMeta}>
        {order.itemCount} items ·{" "}
        {new Intl.NumberFormat("en-PH", { style: "currency", currency: order.currency }).format(
          order.totalMinor / 100,
        )}
      </Text>
      <Text style={styles.orderDate}>
        {new Date(order.committedAt).toLocaleDateString("en-PH", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, paddingTop: 30, paddingHorizontal: 20 },
  heading: {
    color: palette.ink,
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginBottom: 19,
  },
  filters: { flexDirection: "row", gap: 8, marginBottom: 18 },
  filter: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterActive: { backgroundColor: palette.green, borderColor: palette.green },
  filterText: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: "#fff" },
  list: { paddingBottom: 28 },
  loading: { marginTop: 24 },
  emptyCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 24,
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
  orderCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 20,
    padding: 18,
    marginBottom: 10,
  },
  pressed: { opacity: 0.75 },
  orderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderNumber: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  arrow: { color: palette.green, fontSize: 25 },
  orderStatus: { color: palette.green, fontSize: 12, fontWeight: "800", marginTop: 5 },
  orderMeta: { color: palette.ink, fontSize: 13, marginTop: 12 },
  orderDate: { color: palette.muted, fontSize: 12, marginTop: 5 },
  errorCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, marginBottom: 16 },
  error: { color: "#b04335", fontSize: 13 },
  retry: { color: palette.green, fontWeight: "800", marginTop: 7 },
});

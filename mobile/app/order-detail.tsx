import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CustomerOrderDetailView } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { getOrder } from "@/lib/commerce-api";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

export default function OrderDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [order, setOrder] = useState<CustomerOrderDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      setOrder(await getOrder(orderId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this order.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

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
        <Text style={styles.toolbarTitle}>Order details</Text>
        <View style={styles.spacer} />
      </View>
      {loading ? <ActivityIndicator color={palette.green} style={styles.loading} /> : null}
      {error ? (
        <View style={styles.status}>
          <Text style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {order ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>ORDER {order.orderNumber}</Text>
            <Text style={styles.heading}>{order.status.replaceAll("_", " ")}</Text>
            <Text style={styles.heroCopy}>{order.progress.detail}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/order-tracking", params: { orderId } })}
            style={styles.reviewCard}
          >
            <Text style={styles.reviewTitle}>Delivery tracking</Text>
            <Text style={styles.reviewCopy}>See the latest rider update ›</Text>
          </Pressable>
          {order.status === "DELIVERED" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/order-feedback", params: { orderId } })}
              style={styles.reviewCard}
            >
              <Text style={styles.reviewTitle}>How was your order?</Text>
              <Text style={styles.reviewCopy}>Rate your FreshMarkets experience ›</Text>
            </Pressable>
          ) : null}
          <Text style={styles.sectionTitle}>Your order progress</Text>
          <View style={styles.card}>
            {order.progress.steps.map((step, index) => (
              <View key={step.key} style={[styles.step, index > 0 && styles.stepBorder]}>
                <View
                  style={[
                    styles.stepDot,
                    step.state === "COMPLETE" && styles.stepComplete,
                    step.state === "CURRENT" && styles.stepCurrent,
                  ]}
                />
                <View style={styles.stepCopy}>
                  <Text style={[styles.stepTitle, step.state === "UPCOMING" && styles.muted]}>
                    {step.key.replaceAll("_", " ")}
                  </Text>
                  {step.achievedAt ? (
                    <Text style={styles.stepTime}>
                      {new Date(step.achievedAt).toLocaleString("en-PH", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.sectionTitle}>Items</Text>
          <View style={styles.card}>
            {order.items.map((item) => (
              <View key={item.orderItemId} style={styles.item}>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemName}>{item.productName}</Text>
                  <Text style={styles.itemVariant}>
                    {item.quantity} × {item.variantName}
                  </Text>
                </View>
                <Text style={styles.itemPrice}>
                  {money(item.lineTotalMinor, order.financial.currency)}
                </Text>
              </View>
            ))}
            <View style={styles.total}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {money(order.financial.totalMinor, order.financial.currency)}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>Delivery</Text>
          <View style={styles.card}>
            <Text style={styles.address}>
              {[
                order.fulfillment.address.addressLine1,
                order.fulfillment.address.barangay,
                order.fulfillment.address.city,
              ]
                .filter(Boolean)
                .join(", ")}
            </Text>
            <Text style={styles.addressMeta}>
              {order.fulfillment.mode === "INSTANT" ? "Instant delivery" : "Scheduled delivery"}
            </Text>
            {order.fulfillment.promisedAt ? (
              <Text style={styles.addressMeta}>
                Promised by{" "}
                {new Date(order.fulfillment.promisedAt).toLocaleString("en-PH", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            ) : null}
          </View>
          {order.timeline.length ? (
            <>
              <Text style={styles.sectionTitle}>Updates</Text>
              <View style={styles.card}>
                {[...order.timeline].reverse().map((entry) => (
                  <View key={entry.eventId} style={styles.timelineEntry}>
                    <Text style={styles.timelineTitle}>{entry.title}</Text>
                    <Text style={styles.timelineDescription}>{entry.description}</Text>
                    <Text style={styles.stepTime}>
                      {new Date(entry.occurredAt).toLocaleString("en-PH", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      ) : null}
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
  loading: { marginTop: 40 },
  status: { padding: 22 },
  error: { color: "#b04335", fontSize: 13 },
  retry: { color: palette.green, fontWeight: "800", marginTop: 10 },
  content: { padding: 20 },
  hero: { backgroundColor: "#e8f3e5", borderRadius: 24, padding: 22 },
  reviewCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 18,
    marginTop: 16,
  },
  reviewTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  reviewCopy: { color: palette.green, fontSize: 13, fontWeight: "700", marginTop: 5 },
  eyebrow: { color: palette.green, fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  heading: { color: palette.ink, fontSize: 24, fontWeight: "800", marginTop: 7 },
  heroCopy: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 7 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 25,
    marginBottom: 11,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 17,
  },
  step: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  stepBorder: { borderTopWidth: 1, borderTopColor: palette.line },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: palette.line,
    marginRight: 15,
  },
  stepComplete: { backgroundColor: palette.green, borderColor: palette.green },
  stepCurrent: { borderColor: palette.green, backgroundColor: "#bfe0bb" },
  stepCopy: { flex: 1 },
  stepTitle: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  muted: { color: palette.muted },
  stepTime: { color: palette.muted, fontSize: 11, marginTop: 4 },
  item: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  itemCopy: { flex: 1 },
  itemName: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  itemVariant: { color: palette.muted, fontSize: 12, marginTop: 3 },
  itemPrice: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  total: {
    borderTopWidth: 1,
    borderTopColor: palette.line,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 15,
    marginTop: 7,
  },
  totalLabel: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  totalValue: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  address: { color: palette.ink, fontSize: 14, lineHeight: 21, fontWeight: "700" },
  addressMeta: { color: palette.muted, fontSize: 12, marginTop: 7 },
  timelineEntry: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.line },
  timelineTitle: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  timelineDescription: { color: palette.ink, fontSize: 12, lineHeight: 17, marginTop: 3 },
});

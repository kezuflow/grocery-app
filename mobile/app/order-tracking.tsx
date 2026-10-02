import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DeliveryTrackingView } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { getOrderTracking } from "@/lib/commerce-api";

const statusCopy: Record<DeliveryTrackingView["availability"], { title: string; detail: string }> =
  {
    NOT_SUPPORTED: {
      title: "Tracking is not available",
      detail: "You can still follow your order progress in Order details.",
    },
    WAITING: {
      title: "Waiting for a rider",
      detail: "We’ll show a rider update when Lalamove assigns one.",
    },
    LIVE: {
      title: "Your rider is on the way",
      detail: "This is the latest position reported by Lalamove.",
    },
    DELAYED: {
      title: "Rider update is delayed",
      detail: "The last rider position may be out of date. Check again shortly.",
    },
    UNAVAILABLE: {
      title: "Tracking is temporarily unavailable",
      detail: "Your order is still in progress. Check Order details for status updates.",
    },
    FINISHED: {
      title: "Delivery journey finished",
      detail: "See Order details for the final delivery status.",
    },
  };

export default function OrderTrackingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [tracking, setTracking] = useState<DeliveryTrackingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!orderId) return;
    setError(null);
    try {
      setTracking(await getOrderTracking(orderId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh tracking.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);
  useEffect(() => {
    if (!tracking?.nextRefreshMilliseconds || tracking.availability === "FINISHED") return;
    let pending = false;
    const timer = setInterval(
      () => {
        if (pending || AppState.currentState !== "active") return;
        pending = true;
        void load().finally(() => {
          pending = false;
        });
      },
      Math.max(5000, Math.min(60000, tracking.nextRefreshMilliseconds)),
    );
    return () => clearInterval(timer);
  }, [tracking, load]);
  const message = tracking ? statusCopy[tracking.availability] : null;
  const rider = tracking?.riderContact;
  const canCall = tracking?.availability === "LIVE" && !!rider?.phone;
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
        <Text style={styles.toolbarTitle}>Delivery tracking</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>YOUR DELIVERY</Text>
          <Text style={styles.heading}>{message?.title || "Checking delivery"}</Text>
          <Text style={styles.copy}>{message?.detail || "Getting the latest status."}</Text>
        </View>
        {loading ? <ActivityIndicator color={palette.green} style={styles.loading} /> : null}
        {error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.action}>Try again ›</Text>
            </Pressable>
          </View>
        ) : null}
        {tracking?.rider &&
        (tracking.availability === "LIVE" || tracking.availability === "DELAYED") ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Latest rider update</Text>
            <Text style={styles.copy}>
              Reported{" "}
              {new Date(tracking.rider.updatedAt).toLocaleString("en-PH", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
            <Text style={styles.hint}>
              The reported position is an observation, not an arrival estimate.
            </Text>
          </View>
        ) : null}
        {tracking?.availability === "LIVE" && rider ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your rider</Text>
            <Text style={styles.copy}>{rider.name || "Lalamove rider"}</Text>
            {canCall ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Call assigned rider"
                onPress={() => {
                  if (rider.phone)
                    void Linking.openURL(`tel:${rider.phone}`).catch(() =>
                      setError("Could not open the phone app."),
                    );
                }}
                style={styles.call}
              >
                <Text style={styles.callText}>Call rider</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh tracking</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.details}>
          <Text style={styles.action}>Back to Order details ›</Text>
        </Pressable>
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
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: palette.ink, fontSize: 33, lineHeight: 36, marginTop: -4 },
  toolbarTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  spacer: { width: 42 },
  content: { padding: 20 },
  hero: { backgroundColor: "#e8f3e5", borderRadius: 24, padding: 22 },
  eyebrow: { color: palette.green, fontSize: 11, letterSpacing: 1, fontWeight: "800" },
  heading: { color: palette.ink, fontSize: 25, fontWeight: "800", marginTop: 7 },
  copy: { color: palette.ink, fontSize: 14, lineHeight: 21, marginTop: 7 },
  card: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
  },
  sectionTitle: { color: palette.ink, fontSize: 17, fontWeight: "800" },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 11 },
  loading: { marginTop: 22 },
  error: { color: "#b04335", fontSize: 13 },
  action: { color: palette.green, fontWeight: "800", fontSize: 13, marginTop: 10 },
  call: {
    borderRadius: 15,
    backgroundColor: palette.green,
    padding: 14,
    alignItems: "center",
    marginTop: 15,
  },
  callText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  refresh: {
    borderRadius: 15,
    borderColor: palette.green,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    marginTop: 20,
  },
  refreshText: { color: palette.green, fontWeight: "800", fontSize: 14 },
  details: { alignItems: "center", padding: 16 },
});

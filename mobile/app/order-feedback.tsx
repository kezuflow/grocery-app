import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OrderFeedbackView } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { getOrder, getOrderFeedback, submitOrderFeedback } from "@/lib/commerce-api";

export default function OrderFeedbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [eligible, setEligible] = useState(false);
  const [existing, setExisting] = useState<OrderFeedbackView | null>(null);
  const [rating, setRating] = useState<OrderFeedbackView["rating"] | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orderId) return;
    let active = true;
    void Promise.all([getOrder(orderId), getOrderFeedback(orderId)])
      .then(([order, feedback]) => {
        if (active) {
          setEligible(order.status === "DELIVERED");
          setExisting(feedback);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load review.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);
  async function submit() {
    if (!orderId || !rating) return;
    setSending(true);
    setError(null);
    try {
      setExisting(await submitOrderFeedback(orderId, rating, comment.trim() || null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit your review.");
    } finally {
      setSending(false);
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
        <Text style={styles.toolbarTitle}>Rate your order</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={palette.green} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {existing ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Thank you for sharing</Text>
            <Text style={styles.copy}>
              Your {existing.rating}-star feedback was sent privately to FreshMarkets.
            </Text>
            {existing.comment ? <Text style={styles.comment}>{existing.comment}</Text> : null}
          </View>
        ) : eligible ? (
          <>
            <Text style={styles.heading}>How was your order?</Text>
            <Text style={styles.copy}>
              Rate your overall shopping and delivery experience. Your feedback stays private with
              FreshMarkets.
            </Text>
            <View style={styles.stars}>
              {([1, 2, 3, 4, 5] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} star${value > 1 ? "s" : ""}`}
                  accessibilityState={{ selected: rating === value }}
                  onPress={() => setRating(value)}
                  style={styles.starButton}
                >
                  <Text style={[styles.star, rating && value <= rating && styles.selectedStar]}>
                    {rating && value <= rating ? "★" : "☆"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Anything else? (optional)</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              maxLength={1000}
              multiline
              textAlignVertical="top"
              placeholder="Tell us what went well or what to improve"
              placeholderTextColor={palette.muted}
              style={styles.input}
              accessibilityLabel="Review comment"
            />
            <Pressable
              accessibilityRole="button"
              disabled={!rating || sending}
              onPress={() => void submit()}
              style={[styles.primary, (!rating || sending) && styles.disabled]}
            >
              <Text style={styles.primaryText}>{sending ? "Sending…" : "Send feedback"}</Text>
            </Pressable>
          </>
        ) : !loading && !error ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Available after delivery</Text>
            <Text style={styles.copy}>You can rate the order once delivery is complete.</Text>
          </View>
        ) : null}
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
  card: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  },
  heading: { color: palette.ink, fontSize: 25, fontWeight: "800" },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: 10 },
  stars: { flexDirection: "row", justifyContent: "space-between", marginVertical: 28 },
  starButton: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.line,
    borderWidth: 1,
  },
  star: { fontSize: 37, color: palette.muted },
  selectedStar: { color: palette.green },
  label: { color: palette.ink, fontSize: 16, fontWeight: "800", marginBottom: 10 },
  input: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 17,
    padding: 16,
    minHeight: 130,
    color: palette.ink,
    fontSize: 14,
  },
  primary: {
    backgroundColor: palette.green,
    borderRadius: 16,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  disabled: { opacity: 0.5 },
  error: { color: "#b04335", fontSize: 13, marginBottom: 16 },
  comment: { color: palette.ink, fontSize: 14, marginTop: 14 },
});

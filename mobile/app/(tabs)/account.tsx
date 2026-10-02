import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { palette } from "@/constants/palette";
import { authClient } from "@/lib/auth-client";
import { useLocation } from "@/lib/location-context";

export default function AccountScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { location } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) setError(result.error.message || "Could not sign out.");
    } catch {
      setError("Could not sign out. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Your account</Text>
      {isPending ? (
        <ActivityIndicator color={palette.green} style={styles.loading} />
      ) : session?.user ? (
        <>
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {session.user.name?.slice(0, 1).toUpperCase() || "F"}
              </Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={styles.name}>{session.user.name}</Text>
              <Text style={styles.email}>{session.user.email}</Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>Shopping</Text>
          <AccountRow
            title="Your orders"
            subtitle="See order progress and past purchases"
            onPress={() => router.push("/(tabs)/orders")}
          />
          <AccountRow
            title="Saved favorites"
            subtitle="Your fresh picks in one place"
            onPress={() => router.push("/favorites")}
          />
          <AccountRow
            title="Delivery address"
            subtitle={location?.displayAddress || "Choose where to deliver"}
            onPress={() => router.push("/location")}
          />
          <Text style={styles.sectionTitle}>Account</Text>
          <AccountRow
            title={signingOut ? "Signing out…" : "Sign out"}
            subtitle="You can still browse the market"
            onPress={() => void signOut()}
            disabled={signingOut}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      ) : (
        <>
          <View style={styles.guestCard}>
            <Text style={styles.guestTitle}>Shop with your FreshMarkets account</Text>
            <Text style={styles.guestCopy}>Keep your cart and orders together in one place.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/auth")}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Sign in or create account</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionTitle}>Browse</Text>
          <AccountRow
            title="Delivery address"
            subtitle={location?.displayAddress || "Choose where to deliver"}
            onPress={() => router.push("/location")}
          />
        </>
      )}
    </ScrollView>
  );
}

function AccountRow({
  title,
  subtitle,
  onPress,
  disabled,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, paddingTop: 30, paddingBottom: 35 },
  heading: {
    color: palette.ink,
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginBottom: 22,
  },
  loading: { marginTop: 30 },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    backgroundColor: "#fff",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.line,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#e4f3e4",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: palette.green, fontSize: 24, fontWeight: "800" },
  profileCopy: { flex: 1 },
  name: { color: palette.ink, fontSize: 18, fontWeight: "800" },
  email: { color: palette.muted, fontSize: 13, marginTop: 3 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 28,
    marginBottom: 12,
  },
  row: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 17,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 9,
  },
  pressed: { opacity: 0.75 },
  rowCopy: { flex: 1 },
  rowTitle: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  rowSubtitle: { color: palette.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  arrow: { color: palette.green, fontSize: 28, marginLeft: 12 },
  guestCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 21,
  },
  guestTitle: { color: palette.ink, fontSize: 22, lineHeight: 27, fontWeight: "800" },
  guestCopy: { color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  primary: {
    backgroundColor: palette.green,
    borderRadius: 15,
    height: 51,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  error: { color: "#b04335", fontSize: 13, marginTop: 10 },
});

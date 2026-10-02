import { useRouter } from "expo-router";
import * as DeviceLocation from "expo-location";
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
import type { AddressSearchCandidate, Coordinate } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { confirmLocation, searchAddresses } from "@/lib/catalog-api";
import { useLocation } from "@/lib/location-context";

export default function LocationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { location, selectLocation, forgetLocation } = useLocation();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReadonlyArray<AddressSearchCandidate>>([]);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      void searchAddresses(query.trim())
        .then((items) => {
          if (!cancelled) setCandidates(items);
        })
        .catch((cause) => {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : "Address search is unavailable.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function choose(coordinate: Coordinate) {
    setConfirming(true);
    setError(null);
    try {
      const result = await confirmLocation(coordinate);
      await selectLocation(result);
      if (result.serviceability.serviceable) router.back();
      else setError("FreshMarkets does not deliver to this pin yet. Try another address.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm this address.");
    } finally {
      setConfirming(false);
    }
  }

  async function useDeviceLocation() {
    setError(null);
    try {
      const permission = await DeviceLocation.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("Location access was not granted. Search for your address instead.");
        return;
      }
      const point = await DeviceLocation.getCurrentPositionAsync({
        accuracy: DeviceLocation.Accuracy.Balanced,
      });
      await choose({ latitude: point.coords.latitude, longitude: point.coords.longitude });
    } catch {
      setError("Could not get your location. Search for your address instead.");
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.toolbarTitle}>Delivery address</Text>
        <View style={styles.toolbarSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Where should we deliver?</Text>
        <Text style={styles.description}>
          Choose an address to see products, prices, and availability near you.
        </Text>
        {location ? (
          <View style={styles.currentCard}>
            <Text style={styles.eyebrow}>CURRENT LOCATION</Text>
            <Text style={styles.currentAddress}>{location.displayAddress}</Text>
            <Text style={styles.currentStatus}>
              {location.serviceability.serviceable
                ? "Inside our service area"
                : "Outside our delivery area"}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void forgetLocation()}>
              <Text style={styles.clear}>Clear location</Text>
            </Pressable>
          </View>
        ) : null}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search street, building, or barangay"
          placeholderTextColor="#8a968c"
          accessibilityLabel="Search delivery address"
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          maxLength={200}
        />
        <Pressable
          accessibilityRole="button"
          disabled={confirming}
          onPress={() => void useDeviceLocation()}
          style={({ pressed }) => [styles.deviceButton, pressed && styles.pressed]}
        >
          <Text style={styles.deviceButtonText}>◎ Use my current location</Text>
        </Pressable>
        {searching || confirming ? (
          <ActivityIndicator
            color={palette.green}
            style={styles.spinner}
            accessibilityLabel={confirming ? "Confirming address" : "Searching addresses"}
          />
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {candidates.map((candidate) => (
          <Pressable
            key={candidate.candidateKey}
            accessibilityRole="button"
            disabled={confirming}
            onPress={() => void choose(candidate.coordinate)}
            style={({ pressed }) => [styles.candidate, pressed && styles.pressed]}
          >
            <Text style={styles.pin}>⌖</Text>
            <Text style={styles.candidateText}>{candidate.displayAddress}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        {query.trim().length >= 3 && !searching && !error && candidates.length === 0 ? (
          <Text style={styles.empty}>No addresses found. Try a nearby street or landmark.</Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.skip}>
          <Text style={styles.skipText}>Browse without an address</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  toolbar: {
    minHeight: 62,
    paddingHorizontal: 18,
    paddingBottom: 8,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
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
  toolbarSpacer: { width: 42 },
  content: { padding: 22 },
  heading: {
    color: palette.ink,
    fontSize: 29,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 12,
  },
  description: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 24,
  },
  currentCard: {
    backgroundColor: "#eff7ed",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
  },
  eyebrow: { color: palette.green, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  currentAddress: { color: palette.ink, fontSize: 15, fontWeight: "700", marginTop: 7 },
  currentStatus: { color: palette.muted, fontSize: 12, marginTop: 6 },
  clear: { color: palette.green, fontWeight: "700", fontSize: 12, marginTop: 13 },
  input: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 16,
    height: 54,
    paddingHorizontal: 16,
    color: palette.ink,
    fontSize: 15,
  },
  deviceButton: {
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 16,
    marginTop: 12,
    padding: 16,
  },
  deviceButtonText: { color: palette.green, fontSize: 14, fontWeight: "700" },
  spinner: { marginTop: 20 },
  error: { color: "#b04335", marginTop: 18, fontSize: 13, lineHeight: 19 },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    marginTop: 10,
  },
  pin: { color: palette.green, fontSize: 24 },
  candidateText: { flex: 1, color: palette.ink, fontSize: 14, lineHeight: 20 },
  chevron: { color: palette.muted, fontSize: 24 },
  empty: { color: palette.muted, fontSize: 13, marginTop: 18 },
  skip: { alignSelf: "center", marginTop: 28, padding: 10 },
  skipText: { color: palette.muted, fontSize: 13, textDecorationLine: "underline" },
  pressed: { opacity: 0.72 },
});

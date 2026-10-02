import { useRouter } from "expo-router";
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
import type { AddressSearchCandidate } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";
import { searchAddresses } from "@/lib/catalog-api";
import { createCustomerAddress } from "@/lib/commerce-api";

export default function NewAddressScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<readonly AddressSearchCandidate[]>([]);
  const [selected, setSelected] = useState<AddressSearchCandidate | null>(null);
  const [label, setLabel] = useState("Home");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 3 || selected) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
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
  }, [query, selected]);

  async function save() {
    if (!selected || !label.trim() || !recipient.trim() || !phone.trim()) {
      setError("Choose an address and complete the contact details.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createCustomerAddress({
        candidate: selected,
        label: label.trim(),
        recipient: recipient.trim(),
        phone: phone.trim(),
        instructions: instructions.trim() || null,
      });
      router.replace("/checkout");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this address.");
    } finally {
      setSaving(false);
    }
  }

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
        <Text style={styles.toolbarTitle}>Add address</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Where should we deliver?</Text>
        <Text style={styles.description}>
          Choose an address suggestion, then add the recipient details for your order.
        </Text>
        <Text style={styles.label}>Search address</Text>
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setSelected(null);
          }}
          accessibilityLabel="Search address"
          placeholder="Street, building, or barangay"
          placeholderTextColor="#8a968c"
          style={styles.input}
          maxLength={200}
        />
        {searching ? <ActivityIndicator color={palette.green} style={styles.spinner} /> : null}
        {selected ? (
          <View style={styles.selected}>
            <Text style={styles.selectedLabel}>SELECTED ADDRESS</Text>
            <Text style={styles.selectedText}>{selected.displayAddress}</Text>
          </View>
        ) : (
          candidates.map((item) => (
            <Pressable
              key={item.candidateKey}
              accessibilityRole="button"
              onPress={() => {
                setSelected(item);
                setCandidates([]);
              }}
              style={styles.candidate}
            >
              <Text style={styles.candidateText}>{item.displayAddress}</Text>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))
        )}
        {selected ? (
          <>
            <Text style={styles.label}>Label</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              accessibilityLabel="Address label"
              placeholder="Home or work"
              placeholderTextColor="#8a968c"
              style={styles.input}
              maxLength={100}
            />
            <Text style={styles.label}>Recipient</Text>
            <TextInput
              value={recipient}
              onChangeText={setRecipient}
              accessibilityLabel="Recipient name"
              placeholder="Full name"
              placeholderTextColor="#8a968c"
              autoComplete="name"
              style={styles.input}
              maxLength={200}
            />
            <Text style={styles.label}>Mobile number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              accessibilityLabel="Mobile number"
              placeholder="09xx xxx xxxx"
              placeholderTextColor="#8a968c"
              keyboardType="phone-pad"
              style={styles.input}
              maxLength={30}
            />
            <Text style={styles.label}>Delivery instructions (optional)</Text>
            <TextInput
              value={instructions}
              onChangeText={setInstructions}
              accessibilityLabel="Delivery instructions"
              placeholder="Gate, floor, or helpful landmark"
              placeholderTextColor="#8a968c"
              style={[styles.input, styles.multiline]}
              multiline
              maxLength={1000}
            />
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void save()}
              style={[styles.primary, saving && styles.disabled]}
            >
              <Text style={styles.primaryText}>{saving ? "Saving…" : "Save delivery address"}</Text>
            </Pressable>
          </>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
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
  content: { padding: 20 },
  heading: { color: palette.ink, fontSize: 27, fontWeight: "800" },
  description: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 9,
    marginBottom: 14,
  },
  label: { color: palette.ink, fontSize: 13, fontWeight: "800", marginTop: 19, marginBottom: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 15,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    color: palette.ink,
    fontSize: 14,
  },
  multiline: { minHeight: 84, paddingTop: 13, textAlignVertical: "top" },
  spinner: { marginTop: 17 },
  candidate: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: 16,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  candidateText: { flex: 1, color: palette.ink, fontSize: 13, lineHeight: 18 },
  arrow: { color: palette.green, fontSize: 24, marginLeft: 12 },
  selected: { backgroundColor: "#e8f3e5", borderRadius: 16, padding: 17, marginTop: 13 },
  selectedLabel: { color: palette.green, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  selectedText: { color: palette.ink, fontSize: 14, fontWeight: "700", marginTop: 5 },
  primary: {
    height: 53,
    borderRadius: 16,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  error: { color: "#b04335", fontSize: 13, lineHeight: 18, marginTop: 15 },
});

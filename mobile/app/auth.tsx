import { useRouter } from "expo-router";
import { useState } from "react";
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
import { palette } from "@/constants/palette";
import { authClient } from "@/lib/auth-client";

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password || (mode === "signUp" && !name.trim())) {
      setError("Complete all fields to continue.");
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        mode === "signIn"
          ? await authClient.signIn.email({ email: email.trim(), password })
          : await authClient.signUp.email({ email: email.trim(), password, name: name.trim() });
      if (result.error) {
        setError(result.error.message || "Could not continue. Check your details and try again.");
      } else if (mode === "signUp") {
        setNotice("Check your email for a verification link, then sign in.");
        setMode("signIn");
        setPassword("");
      } else {
        router.back();
      }
    } catch {
      setError("Could not connect to FreshMarkets. Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.eyebrow}>FRESHMARKETS</Text>
        <Text style={styles.heading}>
          {mode === "signIn" ? "Welcome back" : "Create your account"}
        </Text>
        <Text style={styles.description}>
          Sign in to save your cart, follow orders, and shop again faster.
        </Text>
        <View style={styles.card}>
          <View style={styles.switcher}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode("signIn");
                setError(null);
              }}
              style={[styles.switch, mode === "signIn" && styles.switchActive]}
            >
              <Text style={[styles.switchText, mode === "signIn" && styles.switchTextActive]}>
                Sign in
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode("signUp");
                setError(null);
              }}
              style={[styles.switch, mode === "signUp" && styles.switchActive]}
            >
              <Text style={[styles.switchText, mode === "signUp" && styles.switchTextActive]}>
                Create account
              </Text>
            </Pressable>
          </View>
          {mode === "signUp" ? (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoComplete="name"
                style={styles.input}
                accessibilityLabel="Name"
              />
            </>
          ) : null}
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={styles.input}
            accessibilityLabel="Email"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            style={styles.input}
            accessibilityLabel="Password"
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text style={styles.notice} accessibilityRole="alert">
              {notice}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={() => void submit()}
            style={[styles.submit, working && styles.disabled]}
          >
            {working ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === "signIn" ? "Sign in" : "Create account"}
              </Text>
            )}
          </Pressable>
          {mode === "signUp" ? (
            <Text style={styles.hint}>
              We’ll email a verification link before you can place an order.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { paddingHorizontal: 22, paddingBottom: 34 },
  back: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },
  backIcon: { color: palette.ink, fontSize: 33, lineHeight: 36, marginTop: -4 },
  eyebrow: { color: palette.green, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  heading: {
    color: palette.ink,
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginTop: 8,
  },
  description: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 25,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 20,
  },
  switcher: {
    flexDirection: "row",
    borderRadius: 14,
    backgroundColor: palette.background,
    padding: 4,
    marginBottom: 20,
  },
  switch: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 11 },
  switchActive: { backgroundColor: "#fff" },
  switchText: { color: palette.muted, fontWeight: "700", fontSize: 13 },
  switchTextActive: { color: palette.green },
  label: { color: palette.ink, fontSize: 13, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: palette.ink,
    fontSize: 15,
  },
  error: { color: "#b04335", fontSize: 13, marginTop: 16 },
  notice: { color: palette.green, fontSize: 13, marginTop: 16 },
  submit: {
    height: 52,
    backgroundColor: palette.green,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.65 },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: "center" },
});

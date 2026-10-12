import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tokens } from "../lib/tokens";
import { emitReadiness, markShellReady } from "../lib/readiness";
import { mobileEnvironment } from "../lib/runtime-environment";

export function Screen({
  title,
  children,
  testID,
}: {
  title: string;
  children: ReactNode;
  testID: string;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={styles.brand}>FreshMarkets</Text>
          <Text accessibilityRole="header" testID={testID} style={styles.heading}>
            {title}
          </Text>
          <View
            style={styles.body}
            onLayout={() =>
              requestAnimationFrame(() => {
                markShellReady();
                if (__DEV__)
                  emitReadiness("shell-ready", {
                    platform: Platform.OS,
                    buildVariant: mobileEnvironment.variant,
                    backendOrigin: mobileEnvironment.backendOrigin,
                  });
              })
            }
          >
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.background },
  content: { padding: 24, paddingBottom: 40, gap: 16, flexGrow: 1 },
  brand: { color: tokens.action, fontSize: 18, fontWeight: "700" },
  heading: { color: tokens.text, fontSize: 32, fontWeight: "700" },
  body: { gap: 20 },
  card: {
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius,
    borderWidth: 1,
    borderColor: tokens.border,
    padding: 20,
    gap: 12,
  },
  text: { color: tokens.text, fontSize: 18, lineHeight: 27 },
  muted: { color: tokens.muted, fontSize: 16, lineHeight: 24 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: tokens.action,
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: { color: tokens.surface, fontSize: 18, fontWeight: "600" },
  input: {
    backgroundColor: tokens.surface,
    color: tokens.text,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.border,
    padding: 16,
    fontSize: 18,
  },
});

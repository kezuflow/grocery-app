import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Screen, styles } from "../../components/screen";
import { readBackend, type BackendState } from "../../lib/backend";
import { mobileEnvironment as environment } from "../../lib/runtime-environment";
import { emitReadiness } from "../../lib/readiness";

export default function Home() {
  const [state, setState] = useState<BackendState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state.kind === "available" && __DEV__)
      requestAnimationFrame(() =>
        emitReadiness("backend-ready", {
          platform: Platform.OS,
          buildVariant: environment.variant,
          backendOrigin: environment.backendOrigin,
        }),
      );
  }, [state]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void readBackend(environment, controller.signal).then((result) => {
      if (!controller.signal.aborted) setState(result);
    });
    return () => controller.abort();
  }, [attempt]);
  return (
    <Screen title="Home" testID="screen-home">
      <Text style={styles.muted} testID="build-variant">
        {environment.variant}
      </Text>
      <Text style={styles.muted} testID="backend-origin">
        {environment.backendOrigin}
      </Text>
      <View style={styles.card}>
        <Text style={styles.text}>Fresh groceries, closer to home.</Text>
        <Text style={styles.muted}>Shopping is not available in this foundation build.</Text>
      </View>
      <View style={styles.card} accessibilityLiveRegion="polite">
        {state.kind === "loading" && (
          <Text style={styles.muted} testID="backend-loading">
            Checking connection…
          </Text>
        )}
        {state.kind === "available" && (
          <Text style={styles.text} testID="backend-available">
            Connected to the isolated backend.
          </Text>
        )}
        {state.kind === "unavailable" && (
          <>
            <Text style={styles.text} testID="backend-unavailable">
              The backend is unavailable.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
              testID="retry-backend"
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => setAttempt((value) => value + 1)}
            >
              <Text style={styles.buttonText}>Retry connection</Text>
            </Pressable>
          </>
        )}
        <Text style={styles.muted}>
          Connection status does not confirm shopping or payment availability.
        </Text>
      </View>
    </Screen>
  );
}

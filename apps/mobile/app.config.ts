import type { ExpoConfig } from "expo/config";
import { parseEnvironment } from "./lib/environment.ts";

export default function config(): ExpoConfig {
  const environment = parseEnvironment({
    variant: process.env.EXPO_PUBLIC_APP_VARIANT,
    backendOrigin: process.env.EXPO_PUBLIC_BACKEND_ORIGIN,
  });
  return {
    name: environment.variant === "development" ? "FreshMarkets Dev" : "FreshMarkets Beta",
    slug: "freshmarkets-customer",
    version: "0.1.0",
    scheme: environment.scheme,
    orientation: "default",
    userInterfaceStyle: "light",
    plugins: ["expo-router", "expo-dev-client"],
    ios: { bundleIdentifier: environment.applicationId, supportsTablet: false },
    android: { package: environment.applicationId },
    extra: { mobile: environment },
    experiments: { typedRoutes: true },
  };
}

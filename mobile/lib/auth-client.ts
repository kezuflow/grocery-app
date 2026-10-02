import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_MOBILE_API_URL || "http://localhost:8788",
  fetchOptions: { credentials: "include" },
  plugins: [
    expoClient({
      scheme: "freshmarkets",
      storagePrefix: "freshmarkets",
      storage: SecureStore,
    }),
  ],
});

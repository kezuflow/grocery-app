import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ConfirmedBrowsingLocation } from "@freshmarkets/contracts";

const key = "freshmarkets.browsing-location.v1";
let current: ConfirmedBrowsingLocation | null = null;

export async function readLocation(): Promise<ConfirmedBrowsingLocation | null> {
  if (current) return current;
  try {
    const saved =
      Platform.OS === "web"
        ? globalThis.sessionStorage?.getItem(key)
        : await SecureStore.getItemAsync(key);
    if (!saved) return null;
    const value = JSON.parse(saved) as ConfirmedBrowsingLocation;
    if (
      typeof value.displayAddress !== "string" ||
      typeof value.coordinate?.latitude !== "number" ||
      typeof value.coordinate?.longitude !== "number" ||
      (value.browsingContextToken !== null && typeof value.browsingContextToken !== "string")
    )
      return null;
    current = value;
    return value;
  } catch {
    return null;
  }
}

export async function saveLocation(value: ConfirmedBrowsingLocation): Promise<void> {
  const serialized = JSON.stringify(value);
  if (Platform.OS === "web") globalThis.sessionStorage?.setItem(key, serialized);
  else await SecureStore.setItemAsync(key, serialized);
  current = value;
}

export async function clearLocation(): Promise<void> {
  if (Platform.OS === "web") globalThis.sessionStorage?.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
  current = null;
}

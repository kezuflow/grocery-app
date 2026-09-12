export type GoogleMapsBrowserConfiguration = Readonly<{
  browserApiKey?: string;
  mapId?: string;
}>;

export function googleMapsBrowserConfiguration(
  environment: unknown,
): GoogleMapsBrowserConfiguration {
  const bindings = environment as {
    GOOGLE_MAPS_BROWSER_KEY?: unknown;
    GOOGLE_MAPS_MAP_ID?: unknown;
  };
  return {
    browserApiKey: optionalString(bindings.GOOGLE_MAPS_BROWSER_KEY),
    mapId: optionalString(bindings.GOOGLE_MAPS_MAP_ID),
  };
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

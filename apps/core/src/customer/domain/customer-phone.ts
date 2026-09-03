const PHILIPPINE_MOBILE_PATTERN = /^\+639\d{9}$/;

/** Normalize supported local input into the E.164 value owned by Customers. */
export function normalizePhilippineMobile(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const withCountryCode = compact.startsWith("09")
    ? `+63${compact.slice(1)}`
    : compact.startsWith("639")
      ? `+${compact}`
      : compact;
  return PHILIPPINE_MOBILE_PATTERN.test(withCountryCode) ? withCountryCode : null;
}

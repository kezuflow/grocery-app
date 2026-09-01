const PUBLIC_APP_ORIGIN = "https://freshmarkets.local";

/** Accept only same-origin absolute paths for post-authentication navigation. */
export function resolveAuthRedirectPath(
  value: string | ReadonlyArray<string> | undefined,
  fallback = "/",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(candidate, PUBLIC_APP_ORIGIN);
    if (resolved.origin !== PUBLIC_APP_ORIGIN) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

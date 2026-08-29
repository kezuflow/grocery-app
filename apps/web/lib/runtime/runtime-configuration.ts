export type WebRuntimeEnvironment = "development" | "test" | "preview" | "staging" | "production";

const environments = new Set<WebRuntimeEnvironment>([
  "development",
  "test",
  "preview",
  "staging",
  "production",
]);

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function parseWebRuntimeConfiguration(env: {
  ENVIRONMENT?: string;
  PUBLIC_APP_ORIGIN?: string;
}): {
  environment: WebRuntimeEnvironment;
  publicAppOrigin: string;
  secureCookies: boolean;
} {
  if (!env.ENVIRONMENT || !environments.has(env.ENVIRONMENT as WebRuntimeEnvironment))
    throw new Error("ENVIRONMENT_INVALID");
  if (!env.PUBLIC_APP_ORIGIN) throw new Error("PUBLIC_APP_ORIGIN_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(env.PUBLIC_APP_ORIGIN);
  } catch {
    throw new Error("PUBLIC_APP_ORIGIN_INVALID");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("PUBLIC_APP_ORIGIN_INVALID");

  const deployed =
    env.ENVIRONMENT === "preview" ||
    env.ENVIRONMENT === "staging" ||
    env.ENVIRONMENT === "production";
  if (
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) ||
    (deployed && (parsed.protocol !== "https:" || isLoopback(parsed.hostname)))
  )
    throw new Error("PUBLIC_APP_ORIGIN_INSECURE");

  return {
    environment: env.ENVIRONMENT as WebRuntimeEnvironment,
    publicAppOrigin: parsed.origin,
    secureCookies: deployed,
  };
}

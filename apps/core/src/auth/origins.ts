import { parseRuntimeEnvironment } from "../runtime/runtime-configuration";

export type AuthOriginEnvironment = {
  ENVIRONMENT?: string;
  BETTER_AUTH_URL?: string;
  TRUSTED_ORIGINS?: string;
};

const loopbackDevelopmentOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function parseTrustedOrigins(value: string | undefined): readonly string[] {
  if (!value || value.trim() === "") return [];
  const origins: string[] = [];
  for (const entry of value.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`INVALID_TRUSTED_ORIGIN: ${candidate}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error(`INVALID_TRUSTED_ORIGIN: ${candidate}`);
    }
    if (parsed.pathname !== "/") {
      throw new Error(`INVALID_TRUSTED_ORIGIN: ${candidate}`);
    }
    if (parsed.search || parsed.hash) {
      throw new Error(`INVALID_TRUSTED_ORIGIN: ${candidate}`);
    }
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))
    ) {
      throw new Error(`INVALID_TRUSTED_ORIGIN: ${candidate}`);
    }
    const origin = parsed.origin;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

export function trustedOriginsForEnvironment(env: AuthOriginEnvironment): readonly string[] {
  const environment = parseRuntimeEnvironment(env.ENVIRONMENT);
  const deployed =
    environment === "preview" || environment === "staging" || environment === "production";
  if (deployed && !env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL_REQUIRED");
  }
  const configured = parseTrustedOrigins(env.TRUSTED_ORIGINS);
  const base = parseTrustedOrigins(env.BETTER_AUTH_URL);
  const origins = [...base, ...configured].filter(
    (origin, index, all) => all.indexOf(origin) === index,
  );
  if (
    deployed &&
    origins.some((candidate) => {
      const parsed = new URL(candidate);
      return parsed.protocol !== "https:" || isLoopbackHost(parsed.hostname);
    })
  )
    throw new Error("TRUSTED_ORIGIN_INSECURE");
  if (origins.length > 0 || deployed) return origins;
  return loopbackDevelopmentOrigins;
}

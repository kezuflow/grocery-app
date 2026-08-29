export type RuntimeEnvironment =
  | "development"
  | "test"
  | "preview"
  | "staging"
  | "production";

export type CoreRuntimeEnvironment = {
  ENVIRONMENT?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  TRUSTED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PAYMENT_PROVIDER?: string;
};

export type CoreRuntimeConfiguration = {
  environment: RuntimeEnvironment;
  deployed: boolean;
  auth: {
    secret: string;
    baseUrl: string;
    trustedOrigins: readonly string[];
    secureCookies: boolean;
    google: { clientId: string; clientSecret: string } | null;
  };
  payments: {
    providerCode: "mock" | null;
  };
  readiness: {
    auth: boolean;
    googleOauth: boolean;
    payments: boolean;
  };
};

const environments = new Set<RuntimeEnvironment>([
  "development",
  "test",
  "preview",
  "staging",
  "production",
]);
const localSecret = "freshmarkets-local-only-auth-secret-32-characters";
const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;
const configurationCache = new WeakMap<object, CoreRuntimeConfiguration>();

export function parseRuntimeEnvironment(
  value: string | undefined,
  options: { allowLocalDefault?: boolean } = {},
): RuntimeEnvironment {
  if (value === undefined) {
    if (options.allowLocalDefault) return "development";
    throw new Error("ENVIRONMENT_REQUIRED");
  }
  if (!environments.has(value as RuntimeEnvironment)) throw new Error("ENVIRONMENT_INVALID");
  return value as RuntimeEnvironment;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function origin(value: string, name: "BETTER_AUTH_URL" | "TRUSTED_ORIGIN", deployed: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error(`${name}_INVALID`);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname)))
    throw new Error(`${name}_INSECURE`);
  if (deployed && (parsed.protocol !== "https:" || isLoopback(parsed.hostname)))
    throw new Error(`${name}_INSECURE`);
  return parsed.origin;
}

function trustedOrigins(value: string | undefined, deployed: boolean): string[] {
  if (!value?.trim()) return [];
  const result: string[] = [];
  for (const entry of value.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;
    const parsed = origin(candidate, "TRUSTED_ORIGIN", deployed);
    if (!result.includes(parsed)) result.push(parsed);
  }
  return result;
}

export function parseCoreRuntimeConfiguration(
  env: CoreRuntimeEnvironment,
  options: { allowLocalDefault?: boolean } = {},
): CoreRuntimeConfiguration {
  const environment = parseRuntimeEnvironment(env.ENVIRONMENT, options);
  const deployed =
    environment === "preview" || environment === "staging" || environment === "production";

  if (deployed && !env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET_REQUIRED");
  if (deployed && env.BETTER_AUTH_SECRET!.length < 32)
    throw new Error("BETTER_AUTH_SECRET_WEAK");
  const secret = env.BETTER_AUTH_SECRET || localSecret;

  if (deployed && !env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL_REQUIRED");
  const baseUrl = origin(
    env.BETTER_AUTH_URL || localOrigins[0],
    "BETTER_AUTH_URL",
    deployed,
  );
  const configuredOrigins = trustedOrigins(env.TRUSTED_ORIGINS, deployed);
  const authOrigins = [baseUrl, ...configuredOrigins].filter(
    (candidate, index, all) => all.indexOf(candidate) === index,
  );
  if (!deployed && !env.BETTER_AUTH_URL && configuredOrigins.length === 0)
    authOrigins.push(...localOrigins.filter((candidate) => !authOrigins.includes(candidate)));

  const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID);
  const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
  if (hasGoogleId !== hasGoogleSecret) throw new Error("GOOGLE_OAUTH_CONFIGURATION_PARTIAL");
  const google =
    hasGoogleId && hasGoogleSecret
      ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
      : null;

  let providerCode: "mock" | null = null;
  if (env.PAYMENT_PROVIDER === "mock") {
    if (deployed) throw new Error("MOCK_PAYMENT_PROVIDER_FORBIDDEN");
    providerCode = "mock";
  } else if (env.PAYMENT_PROVIDER && env.PAYMENT_PROVIDER !== "disabled") {
    throw new Error("PAYMENT_PROVIDER_INVALID");
  }

  return {
    environment,
    deployed,
    auth: {
      secret,
      baseUrl,
      trustedOrigins: authOrigins,
      secureCookies: deployed,
      google,
    },
    payments: { providerCode },
    readiness: {
      auth: true,
      googleOauth: google !== null,
      payments: providerCode !== null,
    },
  };
}

/** Parse once for a Worker environment object and reuse the closed decision set. */
export function coreRuntimeConfiguration(
  env: CoreRuntimeEnvironment & object,
): CoreRuntimeConfiguration {
  const cached = configurationCache.get(env);
  if (cached) return cached;
  const configuration = parseCoreRuntimeConfiguration(env);
  configurationCache.set(env, configuration);
  return configuration;
}

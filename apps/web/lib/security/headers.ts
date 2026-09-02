import type { WebRuntimeEnvironment } from "../runtime/runtime-configuration";

export type WebSecurityHeader = Readonly<{ key: string; value: string }>;

const MAPBOX_CONTENT_SECURITY_DIRECTIVES = [
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://api.paymongo.com",
] as const;

const DEPLOYED_ENVIRONMENTS = new Set<WebRuntimeEnvironment>(["preview", "staging", "production"]);

export function webContentSecurityPolicy(
  _environment: WebRuntimeEnvironment,
  scriptNonce?: string,
): string {
  if (!scriptNonce) {
    throw new Error("SCRIPT_NONCE_REQUIRED");
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${scriptNonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    ...MAPBOX_CONTENT_SECURITY_DIRECTIVES,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function createScriptNonce(randomUuid: () => string = () => crypto.randomUUID()): string {
  return randomUuid().replaceAll("-", "");
}

function nonCspSecurityHeaders(environment: WebRuntimeEnvironment): WebSecurityHeader[] {
  const deployed = DEPLOYED_ENVIRONMENTS.has(environment);

  const headers: WebSecurityHeader[] = [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(self), payment=(self)",
    },
  ];

  if (deployed) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

export function webSecurityHeaders(
  environment: WebRuntimeEnvironment,
  scriptNonce?: string,
): WebSecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy",
      value: webContentSecurityPolicy(environment, scriptNonce),
    },
    ...nonCspSecurityHeaders(environment),
  ];
}

export function webStaticSecurityHeaders(environment: WebRuntimeEnvironment): WebSecurityHeader[] {
  return nonCspSecurityHeaders(environment);
}

export function resolveSecurityHeaderEnvironment(env: {
  ENVIRONMENT?: string;
  NODE_ENV?: string;
}): WebRuntimeEnvironment {
  if (env.ENVIRONMENT) {
    if (
      env.ENVIRONMENT === "development" ||
      env.ENVIRONMENT === "test" ||
      env.ENVIRONMENT === "preview" ||
      env.ENVIRONMENT === "staging" ||
      env.ENVIRONMENT === "production"
    ) {
      return env.ENVIRONMENT;
    }
    throw new Error("ENVIRONMENT_INVALID");
  }
  return env.NODE_ENV === "production" ? "production" : "development";
}

import type { WebRuntimeEnvironment } from "../runtime/runtime-configuration";

export type WebSecurityHeader = Readonly<{ key: string; value: string }>;

const MAPBOX_CONTENT_SECURITY_DIRECTIVES = [
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
] as const;

const DEPLOYED_ENVIRONMENTS = new Set<WebRuntimeEnvironment>(["preview", "staging", "production"]);

export function webSecurityHeaders(environment: WebRuntimeEnvironment): WebSecurityHeader[] {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    ...MAPBOX_CONTENT_SECURITY_DIRECTIVES,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");

  const headers: WebSecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(self), payment=(self)",
    },
  ];

  if (DEPLOYED_ENVIRONMENTS.has(environment)) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
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

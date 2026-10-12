import { z } from "zod";

const inputSchema = z.object({
  variant: z.enum(["development", "private-beta"]),
  backendOrigin: z.string().url(),
});

export function parseEnvironment(input: unknown) {
  const value = inputSchema.parse(input);
  const url = new URL(value.backendOrigin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Use a backend origin without credentials, paths, queries or fragments");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "freshmarkets.ph" ||
    host.endsWith(".freshmarkets.ph") ||
    host === "freshmarkets-web-production.ilyreggie.workers.dev"
  ) {
    throw new Error("Production is unavailable in the isolated mobile foundation");
  }
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  if (value.variant === "development") {
    if (!local) throw new Error("Development requires an isolated local backend");
    return {
      variant: "development" as const,
      backendOrigin: url.origin,
      applicationId: "ph.freshmarkets.customer.development",
      scheme: "freshmarkets-development",
    };
  }
  if (url.protocol !== "https:" || local)
    throw new Error("Private beta requires an explicit isolated HTTPS backend");
  return {
    variant: "private-beta" as const,
    backendOrigin: url.origin,
    applicationId: "ph.freshmarkets.customer.beta",
    scheme: "freshmarkets-beta",
  };
}

export type MobileEnvironment = ReturnType<typeof parseEnvironment>;

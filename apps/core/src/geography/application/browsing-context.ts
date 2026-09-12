const CONTEXT_VERSION = 1;
const CONTEXT_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const DOMAIN_SEPARATOR = "freshmarkets:browsing-context:v1:";

type BrowsingContextClaims = Readonly<{
  v: 1;
  locationId: string;
  serviceAreaCode: string;
  serviceAreaVersion: number;
  issuedAt: number;
  expiresAt: number;
}>;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueBrowsingContext(
  secret: string,
  input: Readonly<{
    locationId: string;
    serviceAreaCode: string;
    serviceAreaVersion: number;
    now?: number;
  }>,
): Promise<string> {
  const issuedAt = input.now ?? Date.now();
  const claims: BrowsingContextClaims = {
    v: CONTEXT_VERSION,
    locationId: input.locationId,
    serviceAreaCode: input.serviceAreaCode,
    serviceAreaVersion: input.serviceAreaVersion,
    issuedAt,
    expiresAt: issuedAt + CONTEXT_LIFETIME_MILLISECONDS,
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signed = new TextEncoder().encode(`${DOMAIN_SEPARATOR}${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), signed));
  return `${payload}.${base64Url(signature)}`;
}

function claims(value: unknown, now: number): BrowsingContextClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<BrowsingContextClaims>;
  return candidate.v === CONTEXT_VERSION &&
    typeof candidate.locationId === "string" &&
    candidate.locationId.length > 0 &&
    candidate.locationId.length <= 128 &&
    typeof candidate.serviceAreaCode === "string" &&
    candidate.serviceAreaCode.length > 0 &&
    candidate.serviceAreaCode.length <= 128 &&
    Number.isSafeInteger(candidate.serviceAreaVersion) &&
    Number(candidate.serviceAreaVersion) > 0 &&
    Number.isSafeInteger(candidate.issuedAt) &&
    Number.isSafeInteger(candidate.expiresAt) &&
    Number(candidate.issuedAt) <= now &&
    Number(candidate.expiresAt) > now &&
    Number(candidate.expiresAt) - Number(candidate.issuedAt) === CONTEXT_LIFETIME_MILLISECONDS
    ? (candidate as BrowsingContextClaims)
    : null;
}

/** Verify a read-only catalog context. Checkout and Cart never accept this as authority. */
export async function locationFromBrowsingContext(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  if (token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const verificationSignature = new Uint8Array(signatureBytes.byteLength);
  verificationSignature.set(signatureBytes);
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    verificationSignature,
    new TextEncoder().encode(`${DOMAIN_SEPARATOR}${payload}`),
  );
  if (!valid) return null;
  try {
    return claims(JSON.parse(new TextDecoder().decode(payloadBytes)), now)?.locationId ?? null;
  } catch {
    return null;
  }
}

type DeliveryMapCursor = { v: 2; k: "MAP"; s: string; r: string; id: string };
type EligibleRiderCursor = { v: 2; k: "RIDER"; s: string; r: string; id: string };

function encode(value: DeliveryMapCursor | EligibleRiderCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): unknown {
  if (value.length < 1 || value.length > 1_024 || /[^A-Za-z0-9_-]/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function encodeDeliveryMapCursor(scope: string, revision: string, id: string): string {
  return encode({ v: 2, k: "MAP", s: scope, r: revision, id });
}

export function decodeDeliveryMapCursor(
  cursor: string,
  scope: string,
): { revision: string; id: string } | null {
  const value = decode(cursor);
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "k", "r", "s", "v"]) ||
    value.v !== 2 ||
    value.k !== "MAP" ||
    value.s !== scope ||
    typeof value.r !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.r) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 200
  ) {
    return null;
  }
  return { revision: value.r, id: value.id };
}

export function encodeEligibleRiderCursor(scope: string, revision: string, id: string): string {
  return encode({ v: 2, k: "RIDER", s: scope, r: revision, id });
}

export function decodeEligibleRiderCursor(
  cursor: string,
  scope: string,
): { revision: string; id: string } | null {
  const value = decode(cursor);
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "k", "r", "s", "v"]) ||
    value.v !== 2 ||
    value.k !== "RIDER" ||
    value.s !== scope ||
    typeof value.r !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.r) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 200
  ) {
    return null;
  }
  return { revision: value.r, id: value.id };
}

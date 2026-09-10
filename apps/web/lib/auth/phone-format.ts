/** Presentation validation only; Core remains responsible for saved phone values. */
export function normalizeProfilePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const international = compact.startsWith("09")
    ? `+63${compact.slice(1)}`
    : compact.startsWith("639")
      ? `+${compact}`
      : compact;
  return /^\+639\d{9}$/.test(international) ? international : null;
}

export function formatProfilePhone(value: string): string {
  const normalized = normalizeProfilePhone(value);
  if (!normalized) return value;
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`;
}

/** Group partial Philippine mobile input without requiring a complete number. */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits === "0" || digits === "6") return digits;
  const national = digits.startsWith("63")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  const groups = [national.slice(0, 3), national.slice(3, 6), national.slice(6)];
  return ["+63", ...groups.filter(Boolean)].join(" ");
}

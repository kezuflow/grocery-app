export function splitContactName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Customer",
    lastName: parts.slice(1).join(" "),
  };
}

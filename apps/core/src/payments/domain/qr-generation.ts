/** Saved business cutoff, independent of the provider SDK action's lifetime. */
export function scheduledQrGenerationEndsAt(cycleSnapshot: unknown): string | null {
  if (!cycleSnapshot || typeof cycleSnapshot !== "object" || !("cutoffAt" in cycleSnapshot))
    return null;
  const cutoff = cycleSnapshot.cutoffAt;
  return typeof cutoff === "string" && Number.isFinite(Date.parse(cutoff)) ? cutoff : null;
}

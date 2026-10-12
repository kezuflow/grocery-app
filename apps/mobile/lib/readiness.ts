const initializedAt = performance.now();
let shellReceipt: number | null = null;
const launchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emitted = new Set<string>();

export function emitReadiness(
  mark: "shell-ready" | "backend-ready",
  context: { platform: string; buildVariant: string; backendOrigin: string },
) {
  if (emitted.has(mark)) return;
  emitted.add(mark);
  console.info(
    `FM_PERF ${JSON.stringify({ mark, launchId, elapsedMs: performance.now() - initializedAt, ...context })}`,
  );
}

export function markShellReady(now = performance.now()) {
  shellReceipt ??= Math.max(0, now - initializedAt);
  return shellReceipt;
}

export function shellReadyMilliseconds() {
  return shellReceipt;
}

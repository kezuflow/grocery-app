export const READ_TIMEOUT_MS = 15_000;

/** Bound presentation reads only. A deadline does not establish a command's outcome. */
export async function withReadDeadline<T>(read: Promise<T>, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Loading took too long. Please try again."));
          onTimeout?.();
        }, READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Includes response-body consumption in the deadline and preserves caller cancellation. */
export async function readJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  init.signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await withReadDeadline(
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        // Preserve RPC failures (including authentication) for caller handling,
        // but never treat an HTTP failure carrying a success body as success.
        const payload: unknown = await response.json();
        if (
          response.ok === false &&
          !(payload && typeof payload === "object" && "ok" in payload && payload.ok === false)
        )
          throw new Error("This request could not be loaded. Please try again.");
        return payload as T;
      })(),
      cancel,
    );
  } finally {
    init.signal?.removeEventListener("abort", cancel);
  }
}

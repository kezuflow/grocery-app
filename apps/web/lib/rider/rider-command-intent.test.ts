import { describe, expect, it } from "vitest";
import { createRiderCommandIntentStore } from "./rider-command-intent";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function memoryStorage(initial?: string): StorageLike & { value: string | null } {
  let value = initial ?? null;
  return {
    get value() {
      return value;
    },
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}

const command = {
  jobId: "job-1",
  action: "MARK_DELIVERED",
  orderId: "order-1",
  expectedVersion: 7,
} as const;

describe("rider command intent store", () => {
  it("creates one delivery idempotency key for a new job action", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });

    expect(store.begin(command)).toEqual({
      status: "started",
      idempotencyKey: "delivery-uuid-1",
      recovered: false,
    });
  });

  it("reuses the exact key after an ambiguous result and across a new store instance", () => {
    const storage = memoryStorage();
    const first = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });
    const started = first.begin(command);
    first.settle(command, "ambiguous");

    const recovered = createRiderCommandIntentStore({ storage, createKey: () => "uuid-2" });
    expect(recovered.hasRecoverable(command)).toBe(true);
    expect(recovered.begin(command)).toEqual({
      status: "started",
      idempotencyKey: started.idempotencyKey,
      recovered: true,
    });
  });

  it("isolates different job and action identities", () => {
    let sequence = 0;
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => `uuid-${++sequence}`,
    });

    const delivered = store.begin(command);
    const failed = store.begin({ ...command, action: "MARK_FAILED" });
    const otherJob = store.begin({ ...command, jobId: "job-2", orderId: "order-2" });

    expect([delivered.idempotencyKey, failed.idempotencyKey, otherJob.idempotencyKey]).toEqual([
      "delivery-uuid-1",
      "delivery-uuid-2",
      "delivery-uuid-3",
    ]);
  });

  it("never reuses a key when the business payload or expected version changes", () => {
    let sequence = 0;
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => `uuid-${++sequence}`,
    });
    const original = store.begin(command);
    store.settle(command, "ambiguous");

    const changed = { ...command, expectedVersion: 8 };
    const next = store.begin(changed);

    expect(next.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(next.recovered).toBe(false);
    expect(store.hasRecoverable(command)).toBe(false);
    expect(store.hasRecoverable(changed)).toBe(true);
  });

  it.each(["success", "stale", "conflict"] as const)(
    "clears the exact intent and requests an authoritative refresh after %s",
    (outcome) => {
      const store = createRiderCommandIntentStore({
        storage: memoryStorage(),
        createKey: () => "uuid-1",
      });
      store.begin(command);

      expect(store.settle(command, outcome)).toEqual({ refresh: true });
      expect(store.hasRecoverable(command)).toBe(false);
    },
  );

  it.each(["ambiguous", "failure"] as const)(
    "retains the exact intent without requesting a refresh after %s failure",
    (outcome) => {
      const store = createRiderCommandIntentStore({
        storage: memoryStorage(),
        createKey: () => "uuid-1",
      });
      const started = store.begin(command);

      expect(store.settle(command, outcome)).toEqual({ refresh: false });
      expect(store.begin(command)).toMatchObject({
        idempotencyKey: started.idempotencyKey,
        recovered: true,
      });
    },
  );

  it("coalesces a duplicate submit while the exact intent is pending", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    const started = store.begin(command);

    expect(store.begin(command)).toEqual({
      status: "duplicate",
      idempotencyKey: started.idempotencyKey,
      recovered: false,
    });
  });

  it("falls back to memory when session storage is unavailable", () => {
    const unavailable: StorageLike = {
      getItem: () => {
        throw new DOMException("blocked");
      },
      setItem: () => {
        throw new DOMException("blocked");
      },
      removeItem: () => {
        throw new DOMException("blocked");
      },
    };
    const store = createRiderCommandIntentStore({
      storage: unavailable,
      createKey: () => "uuid-1",
    });
    const started = store.begin(command);
    store.settle(command, "ambiguous");

    expect(store.begin(command).idempotencyKey).toBe(started.idempotencyKey);
  });

  it("ignores corrupt session storage without leaking or crashing", () => {
    const storage = memoryStorage("not-json");
    const store = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });

    expect(store.begin(command)).toMatchObject({
      status: "started",
      idempotencyKey: "delivery-uuid-1",
      recovered: false,
    });
    expect(storage.value).not.toContain("not-json");
  });
});

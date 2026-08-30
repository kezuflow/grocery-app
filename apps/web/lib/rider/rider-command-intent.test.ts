import { describe, expect, it } from "vitest";
import { createRiderCommandIntentStore } from "./rider-command-intent";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function memoryStorage(initial?: string): StorageLike & { value: string | null; removed: number } {
  let value = initial ?? null;
  let removed = 0;
  return {
    get value() {
      return value;
    },
    get removed() {
      return removed;
    },
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
      removed += 1;
    },
  };
}

const command = {
  jobId: "job-1",
  action: "MARK_DELIVERED",
  orderId: "order-1",
  expectedVersion: 7,
  status: "ARRIVED",
  allowedActions: ["MARK_DELIVERED", "MARK_FAILED"],
} as const;

type AuthoritativeJob = {
  jobId: string;
  orderId: string;
  expectedVersion: number;
  status: string;
  allowedActions: ReadonlyArray<
    "MARK_EN_ROUTE" | "MARK_ARRIVED" | "MARK_DELIVERED" | "MARK_FAILED"
  >;
};

function reconcile(
  store: ReturnType<typeof createRiderCommandIntentStore>,
  jobs: ReadonlyArray<AuthoritativeJob>,
) {
  return (
    store as unknown as {
      reconcile: (jobs: ReadonlyArray<AuthoritativeJob>) => { cleared: number; retained: number };
    }
  ).reconcile(jobs);
}

function persistedIntent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    identity: "job-1:MARK_DELIVERED",
    jobId: "job-1",
    action: "MARK_DELIVERED",
    orderId: "order-1",
    expectedVersion: 7,
    status: "ARRIVED",
    allowedActions: ["MARK_DELIVERED", "MARK_FAILED"],
    fingerprint:
      '[1,"job-1","MARK_DELIVERED","order-1",7,"ARRIVED",["MARK_DELIVERED","MARK_FAILED"]]',
    idempotencyKey: "delivery-uuid-1",
    ...overrides,
  };
}

function persistedRaw(intent = persistedIntent(), mapKey = "job-1:MARK_DELIVERED"): string {
  return JSON.stringify({ version: 1, intents: { [mapKey]: intent } });
}

describe("rider command intent store", () => {
  it("creates and persists one versioned delivery intent for a new job action", () => {
    const storage = memoryStorage();
    const store = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });

    expect(store.begin(command)).toEqual({
      status: "started",
      idempotencyKey: "delivery-uuid-1",
      recovered: false,
    });
    expect(JSON.parse(storage.value!)).toEqual({
      version: 1,
      intents: { "job-1:MARK_DELIVERED": persistedIntent() },
    });
  });

  it("reuses the exact key after ambiguity and across a new store instance", () => {
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

  it("isolates unresolved intents for different jobs", () => {
    let sequence = 0;
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => `uuid-${++sequence}`,
    });
    const first = store.begin(command);
    const second = store.begin({ ...command, jobId: "job-2", orderId: "order-2" });

    expect([first.idempotencyKey, second.idempotencyKey]).toEqual([
      "delivery-uuid-1",
      "delivery-uuid-2",
    ]);
  });

  it("locks a job against a different action while its original intent is unresolved", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    store.begin(command);

    expect(store.begin({ ...command, action: "MARK_FAILED" })).toEqual({
      status: "blocked",
      reason: "UNRESOLVED_JOB_INTENT",
    });
    expect(store.hasRecoverable(command)).toBe(true);
  });

  it.each([
    { expectedVersion: 8 },
    { orderId: "order-changed" },
    { status: "EN_ROUTE" },
    { allowedActions: ["MARK_FAILED"] as const },
  ])("does not overwrite unresolved evidence when command context changes", (change) => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(store.begin({ ...command, ...change })).toEqual({
      status: "blocked",
      reason: "UNRESOLVED_JOB_INTENT",
    });
    expect(store.hasRecoverable(command)).toBe(true);
  });

  it.each(["success", "stale", "idempotency-conflict"])(
    "clears the exact intent and refreshes after terminal %s",
    (outcome) => {
      const store = createRiderCommandIntentStore({
        storage: memoryStorage(),
        createKey: () => "uuid-1",
      });
      store.begin(command);

      expect(store.settle(command, outcome as Parameters<typeof store.settle>[1])).toEqual({
        refresh: true,
      });
      expect(store.hasRecoverable(command)).toBe(false);
    },
  );

  it("retains the exact intent but refreshes after a generic processing conflict", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    const started = store.begin(command);

    expect(store.settle(command, "processing" as Parameters<typeof store.settle>[1])).toEqual({
      refresh: true,
    });
    expect(store.begin(command)).toMatchObject({
      idempotencyKey: started.idempotencyKey,
      recovered: true,
    });
  });

  it.each(["ambiguous", "failure"] as const)(
    "retains the exact intent without refresh after %s",
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

  it("coalesces a duplicate exact submit while pending", () => {
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

  it("keeps exact recovery when authoritative job state is unchanged", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(reconcile(store, [command])).toEqual({ cleared: 0, retained: 1 });
    expect(store.hasRecoverable(command)).toBe(true);
    expect(store.begin({ ...command, action: "MARK_FAILED" })).toMatchObject({
      status: "blocked",
    });
  });

  it("treats reordered authoritative actions as the same unchanged set", () => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(
      reconcile(store, [{ ...command, allowedActions: ["MARK_FAILED", "MARK_DELIVERED"] }]),
    ).toEqual({ cleared: 0, retained: 1 });
    expect(
      store.hasRecoverable({ ...command, allowedActions: ["MARK_FAILED", "MARK_DELIVERED"] }),
    ).toBe(true);
  });

  it.each([
    ["version advanced", [{ ...command, expectedVersion: 8 }]],
    ["status advanced", [{ ...command, status: "EN_ROUTE" }]],
    ["action set changed", [{ ...command, allowedActions: ["MARK_FAILED"] }]],
  ] as const)("clears unresolved intent when authoritative job has %s", (_case, jobs) => {
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => "uuid-1",
    });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(reconcile(store, jobs)).toEqual({ cleared: 1, retained: 0 });
    expect(store.hasRecoverable(command)).toBe(false);
  });

  it("retains an unresolved intent when the filtered projection omits its job", () => {
    const storage = memoryStorage();
    const store = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(reconcile(store, [])).toEqual({ cleared: 0, retained: 1 });
    expect(store.hasRecoverable(command)).toBe(true);
    expect(reconcile(store, [command])).toEqual({ cleared: 0, retained: 1 });
    expect(store.begin(command)).toMatchObject({
      status: "started",
      idempotencyKey: "delivery-uuid-1",
      recovered: true,
    });
  });

  it("retains absence but clears once a reappearing job proves changed state", () => {
    let sequence = 0;
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => `uuid-${++sequence}`,
    });
    store.begin(command);
    store.settle(command, "ambiguous");

    expect(reconcile(store, [])).toEqual({ cleared: 0, retained: 1 });
    const changed = {
      ...command,
      expectedVersion: 8,
      status: "EN_ROUTE",
      allowedActions: ["MARK_ARRIVED"] as const,
    };
    expect(reconcile(store, [changed])).toEqual({ cleared: 1, retained: 0 });
    expect(store.begin({ ...changed, action: "MARK_ARRIVED" })).toMatchObject({
      status: "started",
      idempotencyKey: "delivery-uuid-2",
      recovered: false,
    });
  });

  it("rebases a late terminal clear and preserves another store's newer intent", () => {
    const storage = memoryStorage();
    const storeA = createRiderCommandIntentStore({ storage, createKey: () => "uuid-a" });
    const jobA = { ...command, jobId: "job-a", orderId: "order-a" };
    storeA.begin(jobA);
    const storeB = createRiderCommandIntentStore({ storage, createKey: () => "uuid-b" });
    const jobB = { ...command, jobId: "job-b", orderId: "order-b" };
    storeB.begin(jobB);

    storeA.settle(jobA, "success");

    const reloaded = createRiderCommandIntentStore({ storage, createKey: () => "unused" });
    expect(reloaded.hasRecoverable(jobA)).toBe(false);
    expect(reloaded.hasRecoverable(jobB)).toBe(true);
  });

  it("rebases late reconciliation and preserves another store's newer intent", () => {
    const storage = memoryStorage();
    const jobA = { ...command, jobId: "job-a", orderId: "order-a" };
    const storeA = createRiderCommandIntentStore({ storage, createKey: () => "uuid-a" });
    storeA.begin(jobA);
    storeA.settle(jobA, "ambiguous");
    const storeB = createRiderCommandIntentStore({ storage, createKey: () => "uuid-b" });
    const jobB = { ...command, jobId: "job-b", orderId: "order-b" };
    storeB.begin(jobB);

    reconcile(storeA, [{ ...jobA, expectedVersion: 8 }, jobB]);

    const reloaded = createRiderCommandIntentStore({ storage, createKey: () => "unused" });
    expect(reloaded.hasRecoverable(jobA)).toBe(false);
    expect(reloaded.hasRecoverable(jobB)).toBe(true);
  });

  it("rebases late admission and preserves intents admitted by another store", () => {
    const storage = memoryStorage();
    const jobA = { ...command, jobId: "job-a", orderId: "order-a" };
    const storeA = createRiderCommandIntentStore({ storage, createKey: () => "uuid-a" });
    storeA.begin(jobA);
    const storeB = createRiderCommandIntentStore({ storage, createKey: () => "uuid-b" });
    const jobB = { ...command, jobId: "job-b", orderId: "order-b" };
    storeB.begin(jobB);
    const jobC = { ...command, jobId: "job-c", orderId: "order-c" };

    expect(storeA.begin(jobC)).toMatchObject({ status: "started" });

    const reloaded = createRiderCommandIntentStore({ storage, createKey: () => "unused" });
    expect(reloaded.hasRecoverable(jobA)).toBe(true);
    expect(reloaded.hasRecoverable(jobB)).toBe(true);
    expect(reloaded.hasRecoverable(jobC)).toBe(true);
  });

  it("never lets a stale terminal result clear a newer mismatched fingerprint", () => {
    const storage = memoryStorage();
    const oldCommand = { ...command, jobId: "shared-job", orderId: "shared-order" };
    const storeA = createRiderCommandIntentStore({ storage, createKey: () => "uuid-old" });
    storeA.begin(oldCommand);
    storeA.settle(oldCommand, "ambiguous");
    const storeB = createRiderCommandIntentStore({ storage, createKey: () => "uuid-new" });
    storeB.settle(oldCommand, "success");
    const changed = {
      ...oldCommand,
      action: "MARK_ARRIVED" as const,
      expectedVersion: 8,
      status: "EN_ROUTE",
      allowedActions: ["MARK_ARRIVED"] as const,
    };
    storeB.begin(changed);

    storeA.settle(oldCommand, "success");

    const reloaded = createRiderCommandIntentStore({ storage, createKey: () => "unused" });
    expect(reloaded.hasRecoverable(changed)).toBe(true);
  });

  it("never lets stale reconciliation clear a newer mismatched fingerprint", () => {
    const storage = memoryStorage();
    const oldCommand = { ...command, jobId: "shared-job", orderId: "shared-order" };
    const storeA = createRiderCommandIntentStore({ storage, createKey: () => "uuid-old" });
    storeA.begin(oldCommand);
    storeA.settle(oldCommand, "ambiguous");
    const storeB = createRiderCommandIntentStore({ storage, createKey: () => "uuid-new" });
    storeB.settle(oldCommand, "success");
    const changed = {
      ...oldCommand,
      action: "MARK_ARRIVED" as const,
      expectedVersion: 8,
      status: "EN_ROUTE",
      allowedActions: ["MARK_ARRIVED"] as const,
    };
    storeB.begin(changed);

    reconcile(storeA, [oldCommand]);

    const reloaded = createRiderCommandIntentStore({ storage, createKey: () => "unused" });
    expect(reloaded.hasRecoverable(changed)).toBe(true);
  });

  it("falls back to memory when storage is unavailable before initialization", () => {
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

  it("blocks a new command if working storage cannot persist it across reload", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota");
      },
      removeItem: () => undefined,
    };
    const store = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });

    expect(store.begin(command)).toEqual({
      status: "blocked",
      reason: "PERSISTENCE_UNAVAILABLE",
    });
    expect(
      createRiderCommandIntentStore({ storage, createKey: () => "uuid-2" }).hasRecoverable(command),
    ).toBe(false);
  });

  it("blocks admission when corrupt persistent storage cannot be cleared", () => {
    const storage: StorageLike = {
      getItem: () => "not-json",
      setItem: () => undefined,
      removeItem: () => {
        throw new DOMException("quota");
      },
    };
    const store = createRiderCommandIntentStore({ storage, createKey: () => "uuid-1" });

    expect(store.begin(command)).toEqual({
      status: "blocked",
      reason: "PERSISTENCE_UNAVAILABLE",
    });
  });

  it("never evicts unresolved evidence when the bounded store is full", () => {
    let sequence = 0;
    const store = createRiderCommandIntentStore({
      storage: memoryStorage(),
      createKey: () => `uuid-${++sequence}`,
    });
    for (let index = 0; index < 32; index += 1) {
      const evidence = { ...command, jobId: `job-${index}`, orderId: `order-${index}` };
      expect(store.begin(evidence).status).toBe("started");
      store.settle(evidence, "ambiguous");
    }

    expect(
      store.begin({ ...command, jobId: "job-over-capacity", orderId: "order-over-capacity" }),
    ).toEqual({ status: "blocked", reason: "CAPACITY_REACHED" });
    expect(store.hasRecoverable({ ...command, jobId: "job-0", orderId: "order-0" })).toBe(true);
  });

  it.each([
    ["legacy unversioned shape", JSON.stringify({ "job-1:MARK_DELIVERED": persistedIntent() })],
    ["map key mismatch", persistedRaw(persistedIntent(), "wrong-key")],
    ["identity mismatch", persistedRaw(persistedIntent({ identity: "wrong" }))],
    ["fingerprint mismatch", persistedRaw(persistedIntent({ fingerprint: "wrong" }))],
    ["unknown action", persistedRaw(persistedIntent({ action: "MARK_PAID" }))],
    ["negative version", persistedRaw(persistedIntent({ expectedVersion: -1 }))],
    ["unsafe version", persistedRaw(persistedIntent({ expectedVersion: Number.MAX_VALUE }))],
    ["oversized id", persistedRaw(persistedIntent({ jobId: "j".repeat(201) }))],
    ["oversized key", persistedRaw(persistedIntent({ idempotencyKey: "k".repeat(201) }))],
    ["oversized raw", " ".repeat(16_385)],
  ])("atomically clears %s persisted storage", (_case, raw) => {
    const storage = memoryStorage(raw);
    const store = createRiderCommandIntentStore({ storage, createKey: () => "fresh" });

    expect(storage.removed).toBe(1);
    expect(store.begin(command)).toMatchObject({
      status: "started",
      idempotencyKey: "delivery-fresh",
      recovered: false,
    });
  });

  it("atomically clears a persisted envelope with too many entries", () => {
    const intents = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => {
        const jobId = `job-${index}`;
        return [
          `${jobId}:MARK_DELIVERED`,
          persistedIntent({
            identity: `${jobId}:MARK_DELIVERED`,
            jobId,
            orderId: `order-${index}`,
            fingerprint: `[1,"${jobId}","MARK_DELIVERED","order-${index}",7,"ARRIVED",["MARK_DELIVERED","MARK_FAILED"]]`,
            idempotencyKey: `delivery-uuid-${index}`,
          }),
        ];
      }),
    );
    const storage = memoryStorage(JSON.stringify({ version: 1, intents }));
    const store = createRiderCommandIntentStore({ storage, createKey: () => "fresh" });

    expect(storage.removed).toBe(1);
    expect(store.begin(command)).toMatchObject({ status: "started", recovered: false });
  });
});

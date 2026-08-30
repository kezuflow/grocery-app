const RIDER_ACTIONS = ["MARK_EN_ROUTE", "MARK_ARRIVED", "MARK_DELIVERED", "MARK_FAILED"] as const;

export type RiderCommandAction = (typeof RIDER_ACTIONS)[number];

export type RiderAuthoritativeJob = {
  jobId: string;
  orderId: string;
  expectedVersion: number;
  status: string;
  allowedActions: ReadonlyArray<RiderCommandAction>;
};

export type RiderCommandEvidence = RiderAuthoritativeJob & {
  action: RiderCommandAction;
};

export type RiderCommandOutcome =
  | "success"
  | "stale"
  | "idempotency-conflict"
  | "processing"
  | "ambiguous"
  | "failure";

type StoredIntent = {
  identity: string;
  jobId: string;
  action: RiderCommandAction;
  orderId: string;
  expectedVersion: number;
  status: string;
  allowedActions: ReadonlyArray<RiderCommandAction>;
  fingerprint: string;
  idempotencyKey: string;
};

type StoredIntents = Record<string, StoredIntent>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "freshmarkets:rider-command-intents:v1";
const SCHEMA_VERSION = 1;
const MAX_RAW_CHARS = 16_384;
const MAX_INTENTS = 32;
const MAX_IDENTIFIER_CHARS = 200;
const MAX_STATUS_CHARS = 64;
const MAX_IDEMPOTENCY_KEY_CHARS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isRiderAction(value: unknown): value is RiderCommandAction {
  return typeof value === "string" && RIDER_ACTIONS.includes(value as RiderCommandAction);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function identityFor(command: Pick<RiderCommandEvidence, "jobId" | "action">): string {
  return `${command.jobId}:${command.action}`;
}

function normalizedActions(
  actions: ReadonlyArray<RiderCommandAction>,
): ReadonlyArray<RiderCommandAction> {
  return [...actions].sort();
}

function fingerprintFor(command: RiderCommandEvidence): string {
  return JSON.stringify([
    SCHEMA_VERSION,
    command.jobId,
    command.action,
    command.orderId,
    command.expectedVersion,
    command.status,
    normalizedActions(command.allowedActions),
  ]);
}

function validActions(value: unknown): value is ReadonlyArray<RiderCommandAction> {
  return (
    Array.isArray(value) &&
    value.length <= RIDER_ACTIONS.length &&
    value.every(isRiderAction) &&
    new Set(value).size === value.length
  );
}

function validEvidence(command: RiderCommandEvidence): boolean {
  return (
    isBoundedString(command.jobId, MAX_IDENTIFIER_CHARS) &&
    isRiderAction(command.action) &&
    isBoundedString(command.orderId, MAX_IDENTIFIER_CHARS) &&
    Number.isSafeInteger(command.expectedVersion) &&
    command.expectedVersion >= 0 &&
    isBoundedString(command.status, MAX_STATUS_CHARS) &&
    validActions(command.allowedActions) &&
    command.allowedActions.includes(command.action)
  );
}

function parseStoredIntent(mapKey: string, value: unknown): StoredIntent | null {
  if (!isRecord(value)) return null;
  if (
    !hasExactKeys(value, [
      "identity",
      "jobId",
      "action",
      "orderId",
      "expectedVersion",
      "status",
      "allowedActions",
      "fingerprint",
      "idempotencyKey",
    ])
  )
    return null;
  const candidate = value as StoredIntent;
  if (
    !validEvidence(candidate) ||
    !isBoundedString(candidate.identity, MAX_IDENTIFIER_CHARS + MAX_STATUS_CHARS) ||
    candidate.identity !== identityFor(candidate) ||
    mapKey !== candidate.identity ||
    !isBoundedString(candidate.idempotencyKey, MAX_IDEMPOTENCY_KEY_CHARS) ||
    candidate.fingerprint !== fingerprintFor(candidate)
  )
    return null;
  return candidate;
}

function parseStoredIntents(raw: string): StoredIntents | null {
  if (raw.length > MAX_RAW_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["version", "intents"])) return null;
  if (parsed.version !== SCHEMA_VERSION || !isRecord(parsed.intents)) return null;
  const entries = Object.entries(parsed.intents);
  if (entries.length > MAX_INTENTS) return null;
  const intents: StoredIntents = {};
  const jobIds = new Set<string>();
  for (const [mapKey, value] of entries) {
    const intent = parseStoredIntent(mapKey, value);
    if (!intent || jobIds.has(intent.jobId)) return null;
    jobIds.add(intent.jobId);
    intents[mapKey] = intent;
  }
  return intents;
}

function serialize(intents: StoredIntents): string | null {
  const raw = JSON.stringify({ version: SCHEMA_VERSION, intents });
  return raw.length <= MAX_RAW_CHARS ? raw : null;
}

function browserSessionStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function createRiderCommandIntentStore(options?: {
  storage?: StorageLike;
  createKey?: () => string;
}) {
  let storage = options?.storage ?? browserSessionStorage();
  const createKey = options?.createKey ?? (() => crypto.randomUUID());
  let intents: StoredIntents = {};
  let persistent = false;
  let persistenceBroken = false;
  if (storage) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(STORAGE_KEY);
      persistent = true;
    } catch {
      storage = undefined;
      persistent = false;
    }
    if (persistent && raw) {
      const parsed = parseStoredIntents(raw);
      if (parsed) intents = parsed;
      else {
        try {
          storage!.removeItem(STORAGE_KEY);
        } catch {
          persistenceBroken = true;
        }
      }
    }
  }
  const inFlight = new Map<string, string>();

  function latestForMutation(): StoredIntents | null {
    if (!persistent) return intents;
    if (persistenceBroken) return null;
    try {
      const raw = storage!.getItem(STORAGE_KEY);
      if (!raw) {
        intents = {};
        return intents;
      }
      const parsed = parseStoredIntents(raw);
      if (parsed) {
        intents = parsed;
        return intents;
      }
      try {
        storage!.removeItem(STORAGE_KEY);
        intents = {};
        return intents;
      } catch {
        persistenceBroken = true;
        return null;
      }
    } catch {
      return null;
    }
  }

  function write(candidate: StoredIntents): "committed" | "too-large" | "unavailable" {
    const raw = serialize(candidate);
    if (!raw) return "too-large";
    if (persistenceBroken) return "unavailable";
    if (persistent) {
      try {
        storage!.setItem(STORAGE_KEY, raw);
      } catch {
        return "unavailable";
      }
    }
    intents = candidate;
    return "committed";
  }

  function exactIntent(command: RiderCommandEvidence): StoredIntent | undefined {
    const intent = intents[identityFor(command)];
    return intent?.fingerprint === fingerprintFor(command) ? intent : undefined;
  }

  return {
    begin(command: RiderCommandEvidence) {
      const latest = latestForMutation();
      if (!latest) {
        return { status: "blocked" as const, reason: "PERSISTENCE_UNAVAILABLE" as const };
      }
      const fingerprint = fingerprintFor(command);
      const existingForJob = Object.values(latest).find((intent) => intent.jobId === command.jobId);
      if (existingForJob && existingForJob.fingerprint !== fingerprint) {
        return { status: "blocked" as const, reason: "UNRESOLVED_JOB_INTENT" as const };
      }
      if (!validEvidence(command)) {
        return { status: "blocked" as const, reason: "INVALID_EVIDENCE" as const };
      }
      const exact = existingForJob?.fingerprint === fingerprint ? existingForJob : undefined;
      if (inFlight.get(command.jobId) === fingerprint && exact) {
        return {
          status: "duplicate" as const,
          idempotencyKey: exact.idempotencyKey,
          recovered: false,
        };
      }
      if (exact) {
        inFlight.set(command.jobId, fingerprint);
        return {
          status: "started" as const,
          idempotencyKey: exact.idempotencyKey,
          recovered: true,
        };
      }
      if (Object.keys(latest).length >= MAX_INTENTS) {
        return { status: "blocked" as const, reason: "CAPACITY_REACHED" as const };
      }
      const identity = identityFor(command);
      const intent: StoredIntent = {
        ...command,
        allowedActions: normalizedActions(command.allowedActions),
        identity,
        fingerprint,
        idempotencyKey: `delivery-${createKey()}`,
      };
      if (parseStoredIntent(identity, intent) === null) {
        return { status: "blocked" as const, reason: "INVALID_EVIDENCE" as const };
      }
      const result = write({ ...latest, [identity]: intent });
      if (result === "too-large") {
        return { status: "blocked" as const, reason: "CAPACITY_REACHED" as const };
      }
      if (result === "unavailable") {
        return { status: "blocked" as const, reason: "PERSISTENCE_UNAVAILABLE" as const };
      }
      inFlight.set(command.jobId, fingerprint);
      return {
        status: "started" as const,
        idempotencyKey: intent.idempotencyKey,
        recovered: false,
      };
    },

    hasRecoverable(command: RiderCommandEvidence): boolean {
      return Boolean(validEvidence(command) && exactIntent(command));
    },

    settle(command: RiderCommandEvidence, outcome: RiderCommandOutcome): { refresh: boolean } {
      const fingerprint = fingerprintFor(command);
      if (inFlight.get(command.jobId) === fingerprint) inFlight.delete(command.jobId);
      const clearable =
        outcome === "success" || outcome === "stale" || outcome === "idempotency-conflict";
      if (clearable) {
        const latest = latestForMutation();
        if (!latest) return { refresh: true };
        const identity = identityFor(command);
        if (latest[identity]?.fingerprint === fingerprint) {
          const candidate = { ...latest };
          delete candidate[identity];
          write(candidate);
        }
      }
      return { refresh: clearable || outcome === "processing" };
    },

    reconcile(authoritativeJobs: ReadonlyArray<RiderAuthoritativeJob>) {
      const observed = intents;
      const latest = latestForMutation();
      if (!latest) return { cleared: 0, retained: Object.keys(intents).length };
      const byJobId = new Map(authoritativeJobs.map((job) => [job.jobId, job]));
      const candidate = { ...latest };
      const originalCount = Object.keys(latest).length;
      let changed = false;
      for (const [identity, intent] of Object.entries(observed)) {
        if (latest[identity]?.fingerprint !== intent.fingerprint) continue;
        const job = byJobId.get(intent.jobId);
        if (!job) continue;
        const unchanged =
          job.orderId === intent.orderId &&
          job.expectedVersion === intent.expectedVersion &&
          job.status === intent.status &&
          JSON.stringify(normalizedActions(job.allowedActions)) ===
            JSON.stringify(intent.allowedActions) &&
          job.allowedActions.includes(intent.action);
        if (!unchanged) {
          delete candidate[identity];
          inFlight.delete(intent.jobId);
          changed = true;
        }
      }
      if (changed && write(candidate) !== "committed") {
        return { cleared: 0, retained: Object.keys(intents).length };
      }
      return {
        cleared: originalCount - Object.keys(candidate).length,
        retained: Object.keys(candidate).length,
      };
    },
  };
}

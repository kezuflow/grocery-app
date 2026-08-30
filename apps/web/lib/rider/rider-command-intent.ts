export type RiderCommandEvidence = {
  jobId: string;
  action: string;
  orderId: string;
  expectedVersion: number;
};

export type RiderCommandOutcome = "success" | "stale" | "conflict" | "ambiguous" | "failure";

type StoredIntent = {
  identity: string;
  fingerprint: string;
  idempotencyKey: string;
};

type StoredIntents = Record<string, StoredIntent>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "freshmarkets:rider-command-intents:v1";

function identityFor(command: RiderCommandEvidence): string {
  return `${command.jobId}:${command.action}`;
}

function fingerprintFor(command: RiderCommandEvidence): string {
  return JSON.stringify([command.jobId, command.action, command.orderId, command.expectedVersion]);
}

function isStoredIntent(value: unknown): value is StoredIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<StoredIntent>;
  return (
    typeof intent.identity === "string" &&
    typeof intent.fingerprint === "string" &&
    typeof intent.idempotencyKey === "string"
  );
}

function readStoredIntents(storage: StorageLike | undefined): StoredIntents {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    const entries = Object.entries(parsed).filter((entry): entry is [string, StoredIntent] =>
      isStoredIntent(entry[1]),
    );
    if (entries.length !== Object.keys(parsed).length) throw new Error("invalid");
    return Object.fromEntries(entries);
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be denied at any time. The in-memory registry remains usable.
    }
    return {};
  }
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
  const storage = options?.storage ?? browserSessionStorage();
  const createKey = options?.createKey ?? (() => crypto.randomUUID());
  const intents = readStoredIntents(storage);
  const inFlight = new Map<string, string>();

  function persist(): void {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(intents));
    } catch {
      // Session storage is an enhancement; memory remains the safe fallback.
    }
  }

  return {
    begin(command: RiderCommandEvidence) {
      const identity = identityFor(command);
      const fingerprint = fingerprintFor(command);
      const existing = intents[identity];
      const exact = existing?.fingerprint === fingerprint ? existing : undefined;

      if (inFlight.get(identity) === fingerprint && exact) {
        return {
          status: "duplicate" as const,
          idempotencyKey: exact.idempotencyKey,
          recovered: false,
        };
      }

      const intent: StoredIntent = exact ?? {
        identity,
        fingerprint,
        idempotencyKey: `delivery-${createKey()}`,
      };
      intents[identity] = intent;
      inFlight.set(identity, fingerprint);
      persist();
      return {
        status: "started" as const,
        idempotencyKey: intent.idempotencyKey,
        recovered: Boolean(exact),
      };
    },

    hasRecoverable(command: RiderCommandEvidence): boolean {
      const intent = intents[identityFor(command)];
      return intent?.fingerprint === fingerprintFor(command);
    },

    settle(command: RiderCommandEvidence, outcome: RiderCommandOutcome): { refresh: boolean } {
      const identity = identityFor(command);
      const fingerprint = fingerprintFor(command);
      if (inFlight.get(identity) === fingerprint) inFlight.delete(identity);

      const terminal = outcome === "success" || outcome === "stale" || outcome === "conflict";
      if (terminal && intents[identity]?.fingerprint === fingerprint) {
        delete intents[identity];
        persist();
      }
      return { refresh: terminal };
    },
  };
}

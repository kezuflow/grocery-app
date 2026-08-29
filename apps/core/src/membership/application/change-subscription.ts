import type { SubscriptionSummary } from "./start-promotional-trial";
import { canTransitionSubscription, type SubscriptionLifecycleState } from "../domain/subscription";

export type PauseSubscriptionCommand = {
  subscriptionId: string;
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
  requestId: string;
};

export type ResumeSubscriptionCommand = {
  subscriptionId: string;
  idempotencyKey: string;
  expectedVersion: number;
  requestId: string;
};

export type CancelSubscriptionCommand = {
  subscriptionId: string;
  timing: "IMMEDIATE" | "PERIOD_END";
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
  requestId: string;
};

export type SubscriptionTransitionOptions = {
  actorType?: "CUSTOMER" | "ADMIN";
  evidence?: (guard: {
    clause: string;
    binds: ReadonlyArray<unknown>;
  }) => ReadonlyArray<D1PreparedStatement>;
};

const SUMMARY_STATE = [
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
] as const;

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

type Row = {
  id: string;
  customer_id: string;
  status: string;
  starts_at: number;
  trial_ends_at: number | null;
  cancel_at_period_end: number;
  cancellation_requested_at: number | null;
  scheduled_cancellation_at: number | null;
  ended_at: number | null;
  version: number;
};

const SELECT =
  "SELECT id, customer_id, status, starts_at, trial_ends_at, cancel_at_period_end, cancellation_requested_at, scheduled_cancellation_at, ended_at, version FROM subscription WHERE id=?";

async function loadSubscription(database: D1Database, id: string): Promise<Row | null> {
  return database.prepare(SELECT).bind(id).first<Row>();
}

function summary(row: Row): SubscriptionSummary {
  return {
    subscriptionId: row.id,
    state: SUMMARY_STATE.includes(row.status as never)
      ? (row.status as SubscriptionSummary["state"])
      : "PENDING",
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    scheduledCancellationAt: toIso(row.scheduled_cancellation_at),
    trialStartsAt: toIso(row.starts_at),
    trialEndsAt: toIso(row.trial_ends_at),
    version: row.version,
  };
}

async function replayOrConflict(
  database: D1Database,
  scope: string,
  key: string,
  hash: string,
  requestId: string,
): Promise<
  { kind: "none" } | { kind: "replay"; row: Row } | { kind: "conflict" } | { kind: "processing" }
> {
  const record = await database
    .prepare(
      "SELECT request_hash, status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(scope, key)
    .first<{ request_hash: string; status: string; result_reference: string | null }>();
  if (!record) return { kind: "none" };
  if (record.request_hash !== hash) return { kind: "conflict" };
  if (record.status === "SUCCEEDED" && record.result_reference) {
    const row = await loadSubscription(database, record.result_reference);
    if (row) return { kind: "replay", row };
  }
  return { kind: "processing" };
}

async function claim(
  database: D1Database,
  scope: string,
  key: string,
  hash: string,
  reference: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES (?, ?, ?, 'subscription', ?, 'PROCESSING', ?, ?)",
    )
    .bind(scope, key, hash, reference, Date.now(), Date.now())
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

function completionStatement(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  guard: { clause: string; binds: ReadonlyArray<unknown> },
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE idempotency_records SET status='SUCCEEDED', updated_at=?
       WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard.clause}`,
    )
    .bind(Date.now(), scope, key, ...guard.binds);
}

async function failClaim(database: D1Database, scope: string, key: string): Promise<void> {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

export async function pauseSubscription(
  database: D1Database,
  command: PauseSubscriptionCommand,
  options: SubscriptionTransitionOptions = {},
): Promise<
  { ok: true; value: SubscriptionSummary; requestId: string } | ReturnType<typeof failure>
> {
  const scope = "membership.pause";
  const requestHashValue = await digest({
    op: "pause",
    subscriptionId: command.subscriptionId,
    reason: command.reason ?? null,
  });
  const replay = await replayOrConflict(
    database,
    scope,
    command.idempotencyKey,
    requestHashValue,
    command.requestId,
  );
  if (replay.kind === "replay")
    return { ok: true, value: summary(replay.row), requestId: command.requestId };
  if (replay.kind === "conflict")
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      command.requestId,
    );
  if (replay.kind === "processing")
    return failure("CONFLICT", "The original pause command is still processing", command.requestId);

  const row = await loadSubscription(database, command.subscriptionId);
  if (!row) return failure("NOT_FOUND", "Subscription not found", command.requestId);
  if (!canTransitionSubscription(row.status as SubscriptionLifecycleState, "PAUSED")) {
    await failClaim(database, scope, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      `Cannot pause a ${row.status} subscription`,
      command.requestId,
    );
  }

  const claimed = await claim(database, scope, command.idempotencyKey, requestHashValue, row.id);
  if (!claimed)
    return failure("CONFLICT", "The original pause command is still processing", command.requestId);

  const now = Date.now();
  const guard = {
    clause: "EXISTS (SELECT 1 FROM subscription WHERE id=? AND status='PAUSED' AND version=?)",
    binds: [row.id, command.expectedVersion + 1] as const,
  };
  try {
    const results = await database.batch([
      database
        .prepare(
          "UPDATE subscription SET status='PAUSED', paused_at=?, version=version+1, updated_at=? WHERE id=? AND status=? AND version=?",
        )
        .bind(now, now, row.id, row.status, command.expectedVersion),
      database
        .prepare(
          `INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at)
           SELECT ?, ?, 'PAUSED', ?, ?, ?, ? WHERE ${guard.clause}`,
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          options.actorType ?? "CUSTOMER",
          JSON.stringify({ reason: command.reason ?? null }),
          now,
          now,
          ...guard.binds,
        ),
      ...(options.evidence?.(guard) ?? []),
      completionStatement(database, scope, command.idempotencyKey, row.id, guard),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      await failClaim(database, scope, command.idempotencyKey);
      return failure(
        "STALE_VERSION",
        "Subscription changed; refresh before retrying",
        command.requestId,
      );
    }
  } catch {
    await failClaim(database, scope, command.idempotencyKey);
    return failure("CONFLICT", "Subscription pause could not be applied", command.requestId);
  }
  const updated = await loadSubscription(database, row.id);
  return { ok: true, value: summary(updated!), requestId: command.requestId };
}

export async function resumeSubscription(
  database: D1Database,
  command: ResumeSubscriptionCommand,
  options: SubscriptionTransitionOptions = {},
): Promise<
  { ok: true; value: SubscriptionSummary; requestId: string } | ReturnType<typeof failure>
> {
  const scope = "membership.resume";
  const requestHashValue = await digest({ op: "resume", subscriptionId: command.subscriptionId });
  const replay = await replayOrConflict(
    database,
    scope,
    command.idempotencyKey,
    requestHashValue,
    command.requestId,
  );
  if (replay.kind === "replay")
    return { ok: true, value: summary(replay.row), requestId: command.requestId };
  if (replay.kind === "conflict")
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      command.requestId,
    );
  if (replay.kind === "processing")
    return failure(
      "CONFLICT",
      "The original resume command is still processing",
      command.requestId,
    );

  const row = await loadSubscription(database, command.subscriptionId);
  if (!row) return failure("NOT_FOUND", "Subscription not found", command.requestId);
  if (!canTransitionSubscription(row.status as SubscriptionLifecycleState, "ACTIVE")) {
    await failClaim(database, scope, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      `Cannot resume a ${row.status} subscription`,
      command.requestId,
    );
  }

  const claimed = await claim(database, scope, command.idempotencyKey, requestHashValue, row.id);
  if (!claimed)
    return failure(
      "CONFLICT",
      "The original resume command is still processing",
      command.requestId,
    );

  const now = Date.now();
  // Resume is the explicit reversal command that clears pending cancellation
  // intent together with the pause itself.
  const guard = {
    clause: "EXISTS (SELECT 1 FROM subscription WHERE id=? AND status='ACTIVE' AND version=?)",
    binds: [row.id, command.expectedVersion + 1] as const,
  };
  try {
    const results = await database.batch([
      database
        .prepare(
          "UPDATE subscription SET status='ACTIVE', paused_at=NULL, resume_at=?, cancel_at_period_end=0, cancellation_requested_at=NULL, scheduled_cancellation_at=NULL, version=version+1, updated_at=? WHERE id=? AND status=? AND version=?",
        )
        .bind(now, now, row.id, row.status, command.expectedVersion),
      database
        .prepare(
          `INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at)
           SELECT ?, ?, 'RESUMED', ?, '{}', ?, ? WHERE ${guard.clause}`,
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          options.actorType ?? "CUSTOMER",
          now,
          now,
          ...guard.binds,
        ),
      ...(options.evidence?.(guard) ?? []),
      completionStatement(database, scope, command.idempotencyKey, row.id, guard),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      await failClaim(database, scope, command.idempotencyKey);
      return failure(
        "STALE_VERSION",
        "Subscription changed; refresh before retrying",
        command.requestId,
      );
    }
  } catch {
    await failClaim(database, scope, command.idempotencyKey);
    return failure("CONFLICT", "Subscription resume could not be applied", command.requestId);
  }
  const updated = await loadSubscription(database, row.id);
  return { ok: true, value: summary(updated!), requestId: command.requestId };
}

export async function cancelSubscription(
  database: D1Database,
  command: CancelSubscriptionCommand,
  options: SubscriptionTransitionOptions = {},
): Promise<
  { ok: true; value: SubscriptionSummary; requestId: string } | ReturnType<typeof failure>
> {
  const scope = "membership.cancel";
  const requestHashValue = await digest({
    op: "cancel",
    subscriptionId: command.subscriptionId,
    timing: command.timing,
    reason: command.reason ?? null,
  });
  const replay = await replayOrConflict(
    database,
    scope,
    command.idempotencyKey,
    requestHashValue,
    command.requestId,
  );
  if (replay.kind === "replay")
    return { ok: true, value: summary(replay.row), requestId: command.requestId };
  if (replay.kind === "conflict")
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      command.requestId,
    );
  if (replay.kind === "processing")
    return failure(
      "CONFLICT",
      "The original cancel command is still processing",
      command.requestId,
    );

  const row = await loadSubscription(database, command.subscriptionId);
  if (!row) return failure("NOT_FOUND", "Subscription not found", command.requestId);

  if (command.timing === "IMMEDIATE") {
    if (!canTransitionSubscription(row.status as SubscriptionLifecycleState, "CANCELED")) {
      await failClaim(database, scope, command.idempotencyKey);
      return failure(
        "ILLEGAL_TRANSITION",
        `Cannot cancel a ${row.status} subscription immediately`,
        command.requestId,
      );
    }
    const claimed = await claim(database, scope, command.idempotencyKey, requestHashValue, row.id);
    if (!claimed)
      return failure(
        "CONFLICT",
        "The original cancel command is still processing",
        command.requestId,
      );
    const now = Date.now();
    const guard = {
      clause: "EXISTS (SELECT 1 FROM subscription WHERE id=? AND status='CANCELED' AND version=?)",
      binds: [row.id, command.expectedVersion + 1] as const,
    };
    try {
      const results = await database.batch([
        database
          .prepare(
            "UPDATE subscription SET status='CANCELED', ended_at=?, cancel_at_period_end=0, version=version+1, updated_at=? WHERE id=? AND status=? AND version=?",
          )
          .bind(now, now, row.id, row.status, command.expectedVersion),
        database
          .prepare(
            `INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at)
             SELECT ?, ?, 'CANCELED', ?, ?, ?, ? WHERE ${guard.clause}`,
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            options.actorType ?? "CUSTOMER",
            JSON.stringify({ timing: "IMMEDIATE", reason: command.reason ?? null }),
            now,
            now,
            ...guard.binds,
          ),
        ...(options.evidence?.(guard) ?? []),
        completionStatement(database, scope, command.idempotencyKey, row.id, guard),
      ]);
      if ((results[0]?.meta?.changes ?? 0) !== 1) {
        await failClaim(database, scope, command.idempotencyKey);
        return failure(
          "STALE_VERSION",
          "Subscription changed; refresh before retrying",
          command.requestId,
        );
      }
    } catch {
      await failClaim(database, scope, command.idempotencyKey);
      return failure(
        "CONFLICT",
        "Subscription cancellation could not be applied",
        command.requestId,
      );
    }
    const updated = await loadSubscription(database, row.id);
    return { ok: true, value: summary(updated!), requestId: command.requestId };
  }

  // PERIOD_END: record the intent only; entitlement stays TRIALING/ACTIVE/
  // PAST_DUE until the explicit effective-time command runs.
  if (!["TRIALING", "ACTIVE", "PAST_DUE"].includes(row.status)) {
    await failClaim(database, scope, command.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      `A ${row.status} subscription has no remaining period to finish`,
      command.requestId,
    );
  }
  const claimed = await claim(database, scope, command.idempotencyKey, requestHashValue, row.id);
  if (!claimed)
    return failure(
      "CONFLICT",
      "The original cancel command is still processing",
      command.requestId,
    );
  const now = Date.now();
  const guard = {
    clause:
      "EXISTS (SELECT 1 FROM subscription WHERE id=? AND cancel_at_period_end=1 AND version=?)",
    binds: [row.id, command.expectedVersion + 1] as const,
  };
  try {
    const results = await database.batch([
      database
        .prepare(
          "UPDATE subscription SET cancel_at_period_end=1, cancellation_requested_at=?, version=version+1, updated_at=? WHERE id=? AND status=? AND version=?",
        )
        .bind(now, now, row.id, row.status, command.expectedVersion),
      database
        .prepare(
          `INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at)
           SELECT ?, ?, 'CANCELLATION_REQUESTED', ?, ?, ?, ? WHERE ${guard.clause}`,
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          options.actorType ?? "CUSTOMER",
          JSON.stringify({ timing: "PERIOD_END", reason: command.reason ?? null }),
          now,
          now,
          ...guard.binds,
        ),
      ...(options.evidence?.(guard) ?? []),
      completionStatement(database, scope, command.idempotencyKey, row.id, guard),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      await failClaim(database, scope, command.idempotencyKey);
      return failure(
        "STALE_VERSION",
        "Subscription changed; refresh before retrying",
        command.requestId,
      );
    }
  } catch {
    await failClaim(database, scope, command.idempotencyKey);
    return failure("CONFLICT", "Subscription cancellation could not be applied", command.requestId);
  }
  const updated = await loadSubscription(database, row.id);
  return { ok: true, value: summary(updated!), requestId: command.requestId };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const out = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(out)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

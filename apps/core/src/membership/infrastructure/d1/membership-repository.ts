export type SubscriptionRow = {
  id: string;
  customerId: string;
  offerId: string;
  status: string;
  startsAt: number;
  trialEndsAt: number | null;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt: number | null;
  scheduledCancellationAt: number | null;
  endedAt: number | null;
  version: number;
};

function mapSubscription(row: {
  id: string;
  customer_id: string;
  offer_id: string;
  status: string;
  starts_at: number;
  trial_ends_at: number | null;
  cancel_at_period_end: number;
  cancellation_requested_at: number | null;
  scheduled_cancellation_at: number | null;
  ended_at: number | null;
  version: number;
}): SubscriptionRow {
  return {
    id: row.id,
    customerId: row.customer_id,
    offerId: row.offer_id,
    status: row.status,
    startsAt: row.starts_at,
    trialEndsAt: row.trial_ends_at,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    cancellationRequestedAt: row.cancellation_requested_at,
    scheduledCancellationAt: row.scheduled_cancellation_at,
    endedAt: row.ended_at,
    version: row.version,
  };
}

const SUBSCRIPTION_COLUMNS =
  "id, customer_id, offer_id, status, starts_at, trial_ends_at, cancel_at_period_end, cancellation_requested_at, scheduled_cancellation_at, ended_at, version";

export function createMembershipRepository(database: D1Database) {
  return {
    async findOpenSubscriptionByCustomer(customerId: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE customer_id=? AND status IN ('PENDING','TRIALING','ACTIVE','PAST_DUE','PAUSED') ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(customerId)
        .first<{
          id: string;
          customer_id: string;
          offer_id: string;
          status: string;
          starts_at: number;
          trial_ends_at: number | null;
          cancel_at_period_end: number;
          cancellation_requested_at: number | null;
          scheduled_cancellation_at: number | null;
          ended_at: number | null;
          version: number;
        }>();
      return row ? mapSubscription(row) : null;
    },
    async findAnySubscriptionByCustomer(customerId: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(customerId)
        .first<{
          id: string;
          customer_id: string;
          offer_id: string;
          status: string;
          starts_at: number;
          trial_ends_at: number | null;
          cancel_at_period_end: number;
          cancellation_requested_at: number | null;
          scheduled_cancellation_at: number | null;
          ended_at: number | null;
          version: number;
        }>();
      return row ? mapSubscription(row) : null;
    },
    async findSubscriptionById(id: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE id=?`)
        .bind(id)
        .first<{
          id: string;
          customer_id: string;
          offer_id: string;
          status: string;
          starts_at: number;
          trial_ends_at: number | null;
          cancel_at_period_end: number;
          cancellation_requested_at: number | null;
          scheduled_cancellation_at: number | null;
          ended_at: number | null;
          version: number;
        }>();
      return row ? mapSubscription(row) : null;
    },
    async marketTimezone(): Promise<string> {
      const row = await database
        .prepare("SELECT timezone FROM market WHERE status='active' AND is_default=1")
        .first<{ timezone: string }>();
      return row?.timezone ?? "Asia/Manila";
    },
  };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;

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
  agreedPriceVersionId: string | null;
  agreedAmountMinor: number | null;
  agreedCurrency: string | null;
  version: number;
};

type SubscriptionDbRow = {
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
  agreed_price_version_id: string | null;
  agreed_amount_minor: number | null;
  agreed_currency: string | null;
  version: number;
};

function mapSubscription(row: SubscriptionDbRow): SubscriptionRow {
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
    agreedPriceVersionId: row.agreed_price_version_id,
    agreedAmountMinor: row.agreed_amount_minor,
    agreedCurrency: row.agreed_currency,
    version: row.version,
  };
}

const SUBSCRIPTION_COLUMNS =
  "id, customer_id, offer_id, status, starts_at, trial_ends_at, cancel_at_period_end, cancellation_requested_at, scheduled_cancellation_at, ended_at, agreed_price_version_id, agreed_amount_minor, agreed_currency, version";

export function createMembershipRepository(database: D1Database) {
  return {
    async findOpenSubscriptionByCustomer(customerId: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE customer_id=? AND status IN ('PENDING','TRIALING','ACTIVE','PAST_DUE','UNPAID') ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(customerId)
        .first<SubscriptionDbRow>();
      return row ? mapSubscription(row) : null;
    },
    async findAnySubscriptionByCustomer(customerId: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(customerId)
        .first<SubscriptionDbRow>();
      return row ? mapSubscription(row) : null;
    },
    async findSubscriptionById(id: string): Promise<SubscriptionRow | null> {
      const row = await database
        .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription WHERE id=?`)
        .bind(id)
        .first<SubscriptionDbRow>();
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

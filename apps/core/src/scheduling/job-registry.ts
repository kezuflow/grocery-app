import { instantDeliveryBookingJob } from "./jobs/instant-delivery-booking";
import type { ScheduledJob } from "./types";
import { productMediaCleanupJob } from "./jobs/product-media-cleanup";
import { deliveryObservationRedriveJob } from "./jobs/delivery-observation-redrive";
import { checkoutHoldExpiryJob } from "./jobs/checkout-hold-expiry";
import { membershipScheduledCancellationsJob } from "./jobs/membership-scheduled-cancellations";
import { deliveryCycleCutoffJob } from "./jobs/delivery-cycle-cutoff";
import { deliveryCycleCloseoutJob } from "./jobs/delivery-cycle-closeout";
import { paymentsReactionRedriveJob } from "./jobs/payments-reaction-redrive";
import { paymentsReconciliationRedriveJob } from "./jobs/payments-reconciliation-redrive";
import { providerInboxRedriveJob } from "./jobs/provider-inbox-redrive";
import { providerActionExpiryJob } from "./jobs/provider-action-expiry";
import { notificationDeliveryJob } from "./jobs/notification-delivery";
import { providerSubscriptionReconciliationJob } from "./jobs/provider-subscription-reconciliation";
import { orderCancellationRefundsJob } from "./jobs/order-cancellation-refunds";

import { refundReconciliationJob } from "./jobs/refund-reconciliation";

const EVERY_MINUTE = "* * * * *";
const EVERY_FIFTEEN_MINUTES = "*/15 * * * *";

// Per-cron job registrations. Every key must appear verbatim in the
// `triggers.crons` array of apps/core/wrangler.jsonc. Later programs extend
// this map with their own modules; nothing else may dispatch scheduled work.
const REGISTRY: Readonly<Record<string, readonly ScheduledJob[]>> = {
  [EVERY_MINUTE]: [
    checkoutHoldExpiryJob,
    instantDeliveryBookingJob,
    orderCancellationRefundsJob,
    refundReconciliationJob,
    membershipScheduledCancellationsJob,
    providerActionExpiryJob,
    deliveryCycleCutoffJob,
    notificationDeliveryJob,
  ],
  [EVERY_FIFTEEN_MINUTES]: [
    productMediaCleanupJob,
    deliveryObservationRedriveJob,
    deliveryCycleCloseoutJob,
    paymentsReactionRedriveJob,
    paymentsReconciliationRedriveJob,
    providerInboxRedriveJob,
    providerSubscriptionReconciliationJob,
  ],
};

export function getJobsForCron(cronExpression: string): readonly ScheduledJob[] {
  return REGISTRY[cronExpression] ?? [];
}

export const SCHEDULED_CRON_EXPRESSIONS: readonly string[] = Object.keys(REGISTRY);

/** Current facts shared by booking admission and the queue, correlated against delivery_job job.
 * A failed provider attempt is not evidence that returned goods can be sent again.
 */
export const deliveryRetryReadySql = `job.status IN ('UNASSIGNED','RETRY_SCHEDULED','FAILED') AND job.batch_id IS NULL AND job.rider_id IS NULL
  AND EXISTS (SELECT 1 FROM delivery_provider_dispatch previous
    WHERE previous.id=(SELECT latest.id FROM delivery_provider_dispatch latest WHERE latest.delivery_job_id=job.id ORDER BY latest.attempt_sequence DESC LIMIT 1)
      AND previous.status IN ('CANCELED','FAILED','RETURNED')
      AND ((previous.status!='RETURNED' AND previous.handed_over_at IS NULL) OR EXISTS (
        SELECT 1 FROM delivery_promise_revision revision WHERE revision.dispatch_id=previous.id AND revision.return_inspected_at IS NOT NULL)))
  AND EXISTS (SELECT 1 FROM grocery_order grocery JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id
    WHERE grocery.id=job.order_id AND fulfillment.location_id=job.location_id
      AND grocery.status IN ('COMMITTED','FULFILLMENT_PENDING','FULFILLMENT_READY')
      AND fulfillment.status IN ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING','PACKED'))
  AND NOT EXISTS (SELECT 1 FROM delivery_provider_command command JOIN delivery_provider_dispatch previous ON previous.id=command.dispatch_id
    WHERE previous.delivery_job_id=job.id AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`;

/** A closed attempt with recorded departure can be reviewed only against still-packed paid goods. */
export const returnedDeliveryInspectionSql = `job.status='FAILED' AND job.batch_id IS NULL AND job.rider_id IS NULL
  AND EXISTS (SELECT 1 FROM delivery_provider_dispatch previous
    JOIN grocery_order grocery ON grocery.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id AND fulfillment.location_id=job.location_id
    WHERE previous.id=(SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=job.id ORDER BY attempt_sequence DESC LIMIT 1)
      AND previous.status IN ('CANCELED','FAILED','RETURNED')
      AND (previous.handed_over_at IS NOT NULL OR previous.status='RETURNED' OR grocery.status='OUT_FOR_DELIVERY')
      AND grocery.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY') AND fulfillment.status IN ('PACKED','HANDED_OFF')
      AND NOT EXISTS (SELECT 1 FROM delivery_promise_revision revision WHERE revision.dispatch_id=previous.id AND revision.return_inspected_at IS NOT NULL))
  AND NOT EXISTS (SELECT 1 FROM delivery_provider_command command JOIN delivery_provider_dispatch previous ON previous.id=command.dispatch_id
    WHERE previous.delivery_job_id=job.id AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`;

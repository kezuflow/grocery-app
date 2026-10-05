/** Orders keeps its exact member set while replacing a definitively rejected Payments attempt. */
export function replaceRejectedCancellationRefundStatements(
  database: D1Database,
  input: { rejectedRefundId: string; replacementRefundId: string; now: number },
): D1PreparedStatement[] {
  return [
    database
      .prepare(`UPDATE order_cancellation_refund_member SET refund_id=?,status='REQUESTED',updated_at=?
      WHERE refund_id=? AND status!='SUCCEEDED'
      AND EXISTS (SELECT 1 FROM order_cancellation cancellation WHERE cancellation.id=order_cancellation_refund_member.cancellation_id AND cancellation.status!='COMPLETED')`)
      .bind(input.replacementRefundId, input.now, input.rejectedRefundId),
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (
      SELECT 1 FROM order_cancellation_refund_member WHERE refund_id=?)`)
      .bind(input.rejectedRefundId),
    database
      .prepare(`UPDATE order_cancellation SET status='REFUNDS_PROCESSING',version=version+1,updated_at=?
      WHERE status!='COMPLETED' AND EXISTS (SELECT 1 FROM order_cancellation_refund_member member
        WHERE member.cancellation_id=order_cancellation.id AND member.refund_id=?)`)
      .bind(input.now, input.replacementRefundId),
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (
      SELECT 1 FROM order_cancellation_refund_member member JOIN order_cancellation cancellation ON cancellation.id=member.cancellation_id
      WHERE member.refund_id=? AND cancellation.status!='REFUNDS_PROCESSING')`)
      .bind(input.replacementRefundId),
  ];
}

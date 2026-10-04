import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { z } from "@freshmarkets/validation";
import { executeAdminE2eSql, queryAdminE2eSql } from "./admin-authenticated-fixture";

/** Synthetic provider observation, real signed inbox and canonical refund application. */
export async function confirmLocalRefund(
  page: Page,
  paymentIntentId: string,
  reference: string,
  amountMinor: number,
) {
  const intent = `'${paymentIntentId.replaceAll("'", "''")}'`;
  const rows = z
    .array(
      z.object({
        results: z.array(
          z.object({ reference: z.string(), status: z.string(), amount: z.number() }),
        ),
      }),
    )
    .parse(
      queryAdminE2eSql(
        `SELECT provider_refund_reference reference,status,amount_minor amount FROM payment_refund WHERE payment_intent_id=${intent}`,
      ),
    )[0]?.results;
  expect(rows).toHaveLength(1);
  const refund = rows?.[0];
  if (!refund) throw new Error("Missing durable refund");
  expect(refund).toMatchObject({ status: "PROCESSING", amount: amountMinor });
  const body = JSON.stringify({
    eventId: crypto.randomUUID(),
    reference,
    kind: "refund",
    refundReference: refund.reference,
    vendorState: "paid",
    amountMinor,
    currency: "PHP",
  });
  const headers = {
    "content-type": "application/json",
    "x-mock-timestamp": String(Date.now()),
    "x-mock-signature": createHash("sha256")
      .update(`mock-provider-test-secret:${body}`)
      .digest("hex"),
  };
  const post = () => page.request.post("/webhooks/payments/mock", { data: body, headers });
  expect(await (await post()).json()).toMatchObject({
    ok: true,
    value: { processingStatus: "APPLIED" },
  });
  expect(await (await post()).json()).toMatchObject({
    ok: true,
    value: { processingStatus: "DUPLICATE" },
  });
  executeAdminE2eSql(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
    (SELECT COUNT(*) FROM payment_refund WHERE payment_intent_id=${intent} AND status='SUCCEEDED' AND amount_minor=${amountMinor}) <> 1 OR
    (SELECT COUNT(*) FROM payment_refund WHERE payment_intent_id=${intent}) <> 1;`);
}

export async function cancelLocalPaidOrder(
  customer: Page,
  orderId: string,
  payment: { intentId: string; reference: string; amountMinor: number },
) {
  await customer.goto(`/orders/${orderId}`);
  await customer.getByRole("button", { name: "Cancel order", exact: true }).click();
  await customer.getByLabel("Reason for cancellation").fill("Synthetic customer cancellation");
  const reply = customer.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/commerce/orders/${orderId}/cancel`) &&
      response.request().method() === "POST",
  );
  await customer.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
  expect(await (await reply).json()).toMatchObject({ ok: true });
  const detail = async () =>
    z
      .object({ ok: z.literal(true), value: z.object({ status: z.string() }) })
      .parse(await (await customer.request.get(`/api/commerce/orders/${orderId}`)).json()).value;
  expect((await detail()).status).toBe("CANCELLATION_REQUESTED");
  await confirmLocalRefund(customer, payment.intentId, payment.reference, payment.amountMinor);
  expect((await detail()).status).toBe("CANCELED");
  executeAdminE2eSql(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
    EXISTS(SELECT 1 FROM committed_demand WHERE order_id='${orderId}' AND status<>'CANCELED') OR
    (SELECT COUNT(*) FROM order_payment_reaction WHERE payment_intent_id='${payment.intentId}') <> 1;`);
}

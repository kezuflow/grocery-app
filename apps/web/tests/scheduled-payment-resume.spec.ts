import { z } from "@freshmarkets/validation";
import { test, expect, executeAdminE2eSql } from "./admin-authenticated-fixture";

const storageKey = "freshmarkets.checkoutPaymentAction";
const image =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=";
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

for (const width of [1440, 390]) {
  for (const scenario of ["cutoff", "issued-qr", "early-closure"] as const) {
    test(`Scheduled Needs payment resumes ${scenario} at ${width}px`, async ({
      signedInPage: page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const profile = z
        .object({ ok: z.literal(true), value: z.object({ customerId: z.string() }) })
        .parse(await (await page.request.get("/api/commerce/profile")).json());
      const cart = z
        .object({ ok: z.literal(true), value: z.object({ id: z.string() }) })
        .parse(await (await page.request.get("/api/commerce/cart")).json());
      const customerId = literal(profile.value.customerId);
      const suffix = crypto.randomUUID();
      const cycleId = `cycle-${suffix}`,
        addressId = `address-${suffix}`;
      const quoteId = `quote-${suffix}`,
        paymentId = `payment-${suffix}`;
      const now = Date.now();
      const cutoff = now + (scenario === "early-closure" ? 5 : -5) * 60_000;
      const cutoffAt = new Date(cutoff).toISOString();
      const clientToken = `pi_${suffix}_client_test`;
      // Synthetic pre-cutoff admission fixture. Recovery/status transport and Core reads are real;
      // PayMongo is intercepted below, never an actual provider transaction.
      executeAdminE2eSql(`
        INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,cutoff_at,delivery_date,status,capacity,allocated,version)
        VALUES (${literal(cycleId)},'market-metro-cebu','Resume fixture',${now - 3600000},${cutoff},${now + 86400000},'${scenario === "early-closure" ? "CUTOFF_REACHED" : "OPEN"}',10,0,1);
        INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at)
        VALUES (${literal(addressId)},${customerId},'Home','Test Customer','+639171234567','{}',10.3,123.9,'active',1,${now},${now});
        INSERT INTO checkout_quote(id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,cycle_snapshot_json,status,version,expires_at,idempotency_key,created_at,updated_at)
        VALUES (${literal(quoteId)},${literal(quoteId)},${customerId},${literal(cart.value.id)},${literal(addressId)},${literal(cycleId)},'SCHEDULED','PHP',100,100,'[{"quantity":1}]',${literal(JSON.stringify({ cutoffAt }))},'ACTIVE',1,${now + 3600000},${literal(quoteId)},${now - 600000},${now});
        INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,payment_method_token,idempotency_key,created_at,updated_at)
        VALUES (${literal(paymentId)},'GROCERY_CHECKOUT','checkout_quote',${literal(quoteId)},${customerId},100,'PHP','REQUIRES_ACTION','qrph',${literal(paymentId)},${now - 600000},${now});
        INSERT INTO payment_provider_action(id,payment_intent_id,provider,provider_reference,action_type,client_token,expires_at,status,created_at,updated_at)
        VALUES (${literal(`action-${suffix}`)},${literal(paymentId)},'paymongo',${literal(`pi_${suffix}`)},'SDK',${literal(clientToken)},${now + 2700000},'ACTIVE',${now - 600000},${now});
      `);
      let providerCalls = 0;
      await page.route("https://api.paymongo.com/**", (route) => {
        providerCalls += 1;
        return route.abort();
      });
      await page.route("**/api/checkout/payment", (route) =>
        route.fulfill({
          json: {
            ok: true,
            value: { publicKey: "pk_test_fixture" },
          },
        }),
      );
      await page.clock.install({ time: new Date(now) });
      await page.goto("/orders?filter=incomplete");
      if (scenario === "issued-qr") {
        await page.evaluate(
          ({ storageKey, paymentId, clientToken, image, expiresAt }) => {
            sessionStorage.setItem(
              storageKey,
              JSON.stringify({
                paymentIntentId: paymentId,
                clientToken,
                qrCode: image,
                qrCodeExpiresAt: expiresAt,
              }),
            );
          },
          {
            storageKey,
            paymentId,
            clientToken,
            image,
            expiresAt: new Date(now + 60_000).toISOString(),
          },
        );
      }
      await page.getByRole("button", { name: "Continue payment" }).click();
      await expect(page).toHaveURL(/\/checkout\/payment$/);
      await expect
        .poll(() =>
          page.evaluate(
            (key) => JSON.parse(sessionStorage.getItem(key) ?? "null")?.qrGenerationEndsAt,
            storageKey,
          ),
        )
        .toBe(cutoffAt);
      if (scenario === "issued-qr") {
        await expect(page.getByRole("img", { name: "QR Ph payment code" })).toHaveAttribute(
          "src",
          image,
        );
        // Advance only browser time: existing code expiry must not renew across saved cutoff.
        await page.clock.fastForward(61_000);
      }
      await expect(page.getByText(/No new QR code can be created/)).toBeVisible();
      await expect(page.getByRole("img", { name: "QR Ph payment code" })).toHaveCount(0);
      expect(providerCalls).toBe(0);
      expect(
        await (
          await page.request.get(`/api/checkout/payment/status?paymentIntentId=${paymentId}`)
        ).json(),
      ).toMatchObject({
        ok: true,
        value: {
          state: "WAITING_FOR_PAYMENT",
          qrGenerationAllowed: false,
          qrGenerationEndsAt: cutoffAt,
        },
      });
    });
  }
}

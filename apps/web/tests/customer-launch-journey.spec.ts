import { expect, test } from "./admin-authenticated-fixture";

test.describe.configure({ timeout: 180000 });
// Actual paid Orders, Problems, additions, refunds and current-price Buy again
// are covered by instant-auto-booking and scheduled-customer-journey, not mocks.
test("the customer account has no enrollment and retired enrollment cannot write", async ({
  signedInPage: page,
}) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /membership|subscription|trial/i })).toHaveCount(0);
  const experience = await (await page.request.get("/api/membership")).json();
  expect(experience).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  const enrolled = await page.request.post("/api/membership/enroll", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { offerId: "retired-offer" },
  });
  expect(await enrolled.json()).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  await page.goto("/account/membership/payment");
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
});

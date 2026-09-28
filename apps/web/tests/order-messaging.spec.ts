import { executeAdminE2eSql, expect, test } from "./admin-authenticated-fixture";

test.describe.configure({ timeout: 180_000 });

test("customer and Admin exchange Order messages with one automatic reply", async ({
  signedInPage,
  adminPage,
}) => {
  const sessionResponse = await signedInPage.request.get("/api/auth/get-session");
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  expect(userId).toBeTruthy();

  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const now = Date.now();
  executeAdminE2eSql(`
    INSERT INTO payment_attempt
      (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      SELECT '${paymentId}',id,100,'PHP','SUCCEEDED','mock','${paymentId}',${now},${now}
      FROM customer WHERE auth_user_id='${userId}';
    INSERT INTO grocery_order
      (id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,
       status,total_minor,currency,created_at,committed_at)
      SELECT '${orderId}',id,'${paymentId}','INSTANT',NULL,'{}',
        'PAID',100,'PHP',${now},${now}
      FROM customer WHERE auth_user_id='${userId}';
  `);

  await signedInPage.goto(`/account/messages/${orderId}`);
  await expect(signedInPage.getByRole("heading", { name: "Order messages" })).toBeVisible();
  await signedInPage.getByRole("textbox", { name: "Message" }).fill("Where is my Order?");
  await signedInPage.getByRole("button", { name: "Send message" }).click();
  await expect(signedInPage.getByText("Where is my Order?")).toBeVisible();
  await expect(signedInPage.getByText("Where is my Order?")).toHaveCSS(
    "background-color",
    "rgb(16, 137, 16)",
  );
  await expect(signedInPage.getByText("Where is my Order?")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect(signedInPage.getByText(/Our team has received your message/)).toBeVisible();

  await adminPage.goto("/admin/messages");
  await adminPage.getByRole("link", { name: new RegExp(orderId) }).click();
  await expect(adminPage.getByText("Where is my Order?")).toBeVisible();
  await expect(signedInPage.getByText("FreshMarkets team is in this chat")).toBeVisible();
  await adminPage.getByRole("textbox", { name: "Message" }).fill("We are checking it now.");
  await expect(signedInPage.getByText("FreshMarkets team is typing…")).toBeVisible();
  await adminPage.getByRole("button", { name: "Send message" }).click();
  await expect(adminPage.getByText("We are checking it now.")).toBeVisible();
  await expect(adminPage.getByText("We are checking it now.")).toHaveCSS(
    "background-color",
    "rgb(16, 137, 16)",
  );
  await expect(signedInPage.getByText("We are checking it now.")).toBeVisible();

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WZkAAAAASUVORK5CYII=",
    "base64",
  );
  await signedInPage.getByLabel("Attach images or PDFs").setInputFiles({
    name: "proof.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(signedInPage.getByText("Ready", { exact: true })).toBeVisible();
  await signedInPage.getByRole("textbox", { name: "Message" }).fill("Photo attached.");
  await signedInPage.getByRole("button", { name: "Send message" }).click();
  await expect(adminPage.getByText("Photo attached.")).toBeVisible();
  const attachment = adminPage.getByRole("link", { name: "Open proof.png" });
  await expect(attachment).toBeVisible();
  const href = await attachment.getAttribute("href");
  expect(href).toBeTruthy();
  const download = await adminPage.request.get(href ?? "");
  expect(download.ok()).toBe(true);
  expect(Buffer.from(await download.body())).toEqual(png);
});

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
    INSERT INTO order_fulfillment_snapshot
      (order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at)
      VALUES ('${orderId}','location-cebu-central','zone-a','INSTANT','{}',${now});
  `);

  await signedInPage.goto(`/account/messages/${orderId}`);
  await expect(signedInPage.getByRole("heading", { name: "Order messages" })).toBeVisible();
  const customerComposer = signedInPage.getByRole("textbox", { name: "Message" });
  await expect(
    signedInPage.getByRole("status", { name: /FreshMarkets team unavailable/ }),
  ).toHaveCSS("background-color", "rgb(156, 163, 175)");
  await customerComposer.fill("Where is my");
  await customerComposer.press("Shift+Enter");
  await expect(customerComposer).toHaveValue("Where is my\n");
  await customerComposer.fill("Where is my Order?");
  await customerComposer.press("Enter");
  await expect(signedInPage.getByText("Where is my Order?")).toBeVisible();
  await expect(signedInPage.getByText("Where is my Order?")).toHaveCSS(
    "background-color",
    "rgb(0, 177, 79)",
  );
  await expect(signedInPage.getByText("Where is my Order?")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect(signedInPage.getByText(/Our team has received your message/)).toBeVisible();
  await expect(
    signedInPage.locator('[data-slot="message-header"]').filter({ hasText: "You" }),
  ).toHaveCount(0);
  await expect(
    signedInPage.locator('[data-slot="message-avatar"][data-sender-kind="CUSTOMER"] svg'),
  ).toBeVisible();
  await expect(
    signedInPage.locator('[data-slot="message-avatar"][data-sender-kind="CUSTOMER"]'),
  ).toHaveCSS("color", "rgb(0, 177, 79)");
  await expect(
    signedInPage.locator('[data-slot="message-avatar"][data-sender-kind="AUTOMATION"] svg'),
  ).toBeVisible();

  await adminPage.goto("/admin/messages");
  await adminPage.getByRole("link", { name: new RegExp(orderId) }).click();
  await expect(adminPage.getByText("Where is my Order?")).toBeVisible();
  await expect(signedInPage.getByRole("status", { name: "FreshMarkets team available" })).toHaveCSS(
    "background-color",
    "rgb(0, 177, 79)",
  );
  await adminPage.getByRole("textbox", { name: "Message" }).fill("We are checking it now.");
  await expect(signedInPage.getByText("FreshMarkets team is typing…")).toBeVisible();
  await adminPage.getByRole("button", { name: "Send message" }).click();
  await expect(adminPage.getByText("We are checking it now.")).toBeVisible();
  await expect(adminPage.getByText("We are checking it now.")).toHaveCSS(
    "background-color",
    "rgb(0, 177, 79)",
  );
  await expect(signedInPage.getByText("We are checking it now.")).toBeVisible();
  await expect(
    signedInPage.locator('[data-slot="message-avatar"][data-sender-kind="ADMIN"] svg'),
  ).toBeVisible();
  await expect(
    adminPage.locator('[data-slot="message-avatar"][data-sender-kind="CUSTOMER"] svg').first(),
  ).toBeVisible();
  const messageGaps = await signedInPage
    .locator('[data-slot="message-scroller-item"]:has([data-slot="message-avatar"])')
    .evaluateAll((elements) =>
      elements
        .slice(1)
        .map((element, index) =>
          Math.round(
            element.getBoundingClientRect().top - elements[index].getBoundingClientRect().bottom,
          ),
        ),
    );
  expect(messageGaps.length).toBeGreaterThan(0);
  expect(messageGaps.every((gap) => gap >= 0 && gap <= 16)).toBe(true);

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

  await signedInPage.goto("/orders");
  await signedInPage.getByRole("button", { name: "Open order chat" }).click();
  await expect(signedInPage.getByRole("dialog", { name: "Order chat" })).toBeVisible();
  await signedInPage
    .getByRole("dialog", { name: "Order chat" })
    .getByRole("button", { name: /^Order / })
    .first()
    .click();
  await expect(
    signedInPage.getByRole("dialog", { name: "Order chat" }).getByText("We are checking it now."),
  ).toBeVisible();
  await signedInPage.setViewportSize({ width: 390, height: 844 });
  const mobileChatBounds = await signedInPage
    .getByRole("dialog", { name: "Order chat" })
    .boundingBox();
  expect(mobileChatBounds).not.toBeNull();
  expect(mobileChatBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileChatBounds!.x + mobileChatBounds!.width).toBeLessThanOrEqual(390);

  await adminPage.getByRole("combobox", { name: "Active admin scope" }).click();
  await adminPage.getByRole("option", { name: "Central Cebu", exact: true }).click();
  const messagesNav = adminPage
    .getByRole("navigation", { name: "Admin navigation" })
    .getByRole("link", { name: "Messages", exact: true });
  await expect(messagesNav).toBeVisible();
  await messagesNav.click();
  await expect(adminPage).toHaveURL(/\/admin\/messages$/);
  await expect(adminPage.getByRole("link", { name: new RegExp(orderId) })).toBeVisible();
  await expect(adminPage.getByText("Acknowledgement settings")).toHaveCount(0);
});

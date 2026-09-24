import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./admin-authenticated-fixture";

const image = readFileSync(
  fileURLToPath(new URL("../public/promos/fresh-this-week.png", import.meta.url)),
);

test("a real local banner draft keeps image and lifecycle rules authoritative", async ({
  adminPage: page,
  promotionsReadOnlyPage: reader,
  deniedAdminPage: denied,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const title = `Seasonal banner ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/admin/banners");
  await expect(page.getByRole("heading", { level: 1, name: "Banners" })).toBeVisible();
  await page.getByRole("button", { name: "Add banner" }).click();
  await expect(page.getByRole("heading", { name: "New banner" })).toBeVisible();
  await page.getByLabel("Title", { exact: false }).fill(title);
  await page.getByLabel("Storefront destination").fill("/#catalog");
  await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Banner saved." })).toBeVisible();
  await expect(page.getByText("Save this draft before choosing its storefront image.")).toHaveCount(
    0,
  );

  await page.getByLabel("Status").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Save banner" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Add an image before activating" }),
  ).toBeVisible();
  await page.getByLabel("Image file").setInputFiles({
    name: "seasonal-banner.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByLabel("Image description").fill("Fresh produce on a seasonal banner");
  await page.getByRole("button", { name: "Save image" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Banner image saved." })).toBeVisible();
  await page.getByLabel("Image description").fill("An unsaved description");
  await expect(page.getByRole("button", { name: "Save banner" })).toBeDisabled();
  await page.getByLabel("Image description").press("Enter");
  await expect(page.getByRole("button", { name: "Save banner" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard image changes" }).click();
  await expect(page.getByLabel("Image description")).toHaveValue(
    "Fresh produce on a seasonal banner",
  );
  await page.getByRole("button", { name: "Save banner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Banner saved." })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toContainText("Active");
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: new RegExp(title) })
        .getByRole("img")
        .evaluate((node: HTMLImageElement) => node.naturalWidth),
    )
    .toBeGreaterThan(0);

  if (process.env.SAUI_CAPTURE_BANNERS === "1") {
    await page.mouse.move(300, 100);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
    await page.getByRole("heading", { name: "Banner details" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/banner-editor-top-1440.png",
      fullPage: true,
      animations: "disabled",
    });
    await page
      .locator("#banner-detail-panel .overflow-y-auto")
      .evaluate((node) => (node.scrollTop = node.scrollHeight));
    await page.screenshot({
      path: "../../docs/operations/checkpoints/evidence/saui-06/banner-editor-active-1440.png",
      fullPage: true,
      animations: "disabled",
    });
  }

  await reader.setViewportSize({ width: 1440, height: 1000 });
  await reader.goto("/admin/banners");
  await expect(reader.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await expect(reader.getByRole("button", { name: "Add banner" })).toHaveCount(0);
  await reader.getByRole("button", { name: new RegExp(title) }).click();
  await expect(reader.getByRole("button", { name: "Save banner" })).toHaveCount(0);
  await expect(reader.getByText("Banner images are read-only.")).toBeVisible();

  await denied.goto("/admin/banners");
  await expect(denied.getByText("Banners are unavailable")).toBeVisible();

  await page.getByLabel("Status").selectOption("INACTIVE");
  await page.mouse.move(300, 180);
  await page.getByRole("button", { name: "Save banner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Banner saved." })).toBeVisible();
  await page.getByLabel("Status").selectOption("ARCHIVED");
  await page.mouse.move(300, 180);
  await page.getByRole("button", { name: "Save banner" }).click();
  await expect(page.getByText("Archived banner", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save banner" })).toHaveCount(0);
});

test("an unconfirmed banner save checks the identical command before unlocking", async ({
  adminPage: page,
}) => {
  const attempts: Array<{ key: string | undefined; body: string | null }> = [];
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/admin/banners", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          requestId: "banner-list",
          value: { items: saved ? [saved] : [] },
        }),
      });
      return;
    }
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Promotion result could not be confirmed; retry the saved request",
            requestId: "unconfirmed-banner",
          },
        }),
      });
      return;
    }
    saved = { ...(JSON.parse(attempts[1].body ?? "{}") as Record<string, unknown>), version: 1 };
    delete saved.expectedVersion;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, requestId: "banner-saved", value: saved }),
    });
  });

  await page.goto("/admin/banners");
  await page.getByRole("button", { name: "Add banner" }).click();
  await page.getByLabel("Title", { exact: false }).fill("Retryable banner");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Check save status" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close banner editor" })).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Save outcome unconfirmed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check save status" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Banner saved." })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].key).toBeTruthy();
  expect(attempts[1]).toEqual(attempts[0]);
});

test("an explicitly rejected banner draft releases its command after a fresh read", async ({
  adminPage: page,
}) => {
  await page.route("**/api/admin/banners", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "GET"
          ? { ok: true, requestId: "empty-banners", value: { items: [] } }
          : {
              ok: false,
              error: {
                code: "CONFLICT",
                message: "Promotion state or access changed; refresh and review",
                requestId: "rejected-banner",
              },
            },
      ),
    });
  });
  await page.goto("/admin/banners");
  await page.getByRole("button", { name: "Add banner" }).click();
  await page.getByLabel("Title", { exact: false }).fill("Rejected draft");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "state or access changed" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Close banner editor" })).toBeEnabled();
});

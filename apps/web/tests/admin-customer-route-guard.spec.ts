import { expect, test } from "./admin-authenticated-fixture";

test("an unconfirmed invitation keeps its retry across sidebar and browser Back attempts", async ({
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin/customers");
  await adminPage.getByRole("button", { name: "Invite customer" }).click();
  await adminPage
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("route-guard@example.com");
  const keys: string[] = [];
  await adminPage.route("**/api/admin/customers/invitations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.abort("failed");
  });
  await adminPage.getByRole("button", { name: "Create invitation", exact: true }).click();
  const retry = adminPage.getByRole("button", { name: "Retry unconfirmed action" });
  await expect(retry).toBeVisible();
  await adminPage.getByRole("link", { name: "Home", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/customers$/);
  await expect(retry).toBeVisible();
  await adminPage.goBack();
  await expect(adminPage).toHaveURL(/\/admin\/customers$/);
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test("an invitation draft asks before leaving through the sidebar", async ({ adminPage }) => {
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto("/admin/customers");
  await adminPage.getByRole("button", { name: "Invite customer" }).click();
  await adminPage
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("draft@example.com");
  adminPage.once("dialog", (dialog) => dialog.dismiss());
  await adminPage.getByRole("link", { name: "Home", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/customers$/);
  await expect(adminPage.getByRole("textbox", { name: "Email address", exact: true })).toHaveValue(
    "draft@example.com",
  );
  adminPage.once("dialog", (dialog) => dialog.accept());
  await adminPage.getByRole("link", { name: "Home", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin$/);
  await adminPage.goBack();
  await expect(adminPage).toHaveURL(/\/admin\/customers$/);
  await adminPage.goBack();
  await expect(adminPage).toHaveURL("about:blank");
});

test("an unconfirmed customer support note keeps its original request on the record", async ({
  adminPage,
  signedInPage,
}) => {
  await signedInPage.goto("/account/profile");
  await expect(signedInPage.getByRole("heading", { name: "Account details" })).toBeVisible();
  const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await adminPage.goto(`/admin/customers?query=${encodeURIComponent(session.user.email)}`);
  await adminPage
    .getByRole("table", { name: "Customer list" })
    .getByRole("link", { name: session.user.email, exact: true })
    .click();
  const note = adminPage.getByRole("textbox", { name: "New support note" });
  await note.fill("Synthetic support follow-up for route recovery.");
  const keys: string[] = [];
  await adminPage.route("**/api/admin/customers/*/notes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.abort("failed");
  });
  await adminPage.getByRole("button", { name: "Add support note" }).click();
  const retry = adminPage.getByRole("button", { name: "Retry unconfirmed action" });
  await expect(retry).toBeVisible();
  await adminPage.getByRole("link", { name: "Home", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/customers\/[^/]+/);
  await adminPage.goBack();
  await expect(adminPage).toHaveURL(/\/admin\/customers\/[^/]+/);
  await expect(note).toHaveValue("Synthetic support follow-up for route recovery.");
  await retry.click();
  await expect(retry).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

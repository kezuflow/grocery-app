import { expect, test } from "./admin-authenticated-fixture";

test("remaining Admin record families render at 1440px", async ({ adminPage }, testInfo) => {
  test.setTimeout(120_000);
  await adminPage.setViewportSize({ width: 1440, height: 900 });

  const categoryResponse = await adminPage.request.get("/api/admin/catalog/categories?limit=50");
  const categories = (await categoryResponse.json()) as {
    ok: boolean;
    value?: { items: Array<{ categoryId: string }> };
  };
  expect(categories.ok).toBe(true);
  const categoryId = categories.value?.items[0]?.categoryId;
  expect(categoryId).toBeTruthy();
  await adminPage.goto(`/admin/catalog/categories/${encodeURIComponent(categoryId!)}`);
  await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await adminPage.screenshot({
    path: testInfo.outputPath("category-detail-1440.png"),
    fullPage: true,
  });

  await adminPage.goto("/admin/staff");
  await expect(adminPage.getByRole("combobox", { name: "Invitation role" })).toBeVisible();
  expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await adminPage.screenshot({ path: testInfo.outputPath("staff-index-1440.png"), fullPage: true });
  const staffResponse = await adminPage.request.get("/api/admin/staff");
  const staff = (await staffResponse.json()) as {
    ok: boolean;
    value?: { items: Array<{ staffId: string }> };
  };
  expect(staff.ok).toBe(true);
  const staffId = staff.value?.items[0]?.staffId;
  expect(staffId).toBeTruthy();
  await adminPage.goto(`/admin/staff/${encodeURIComponent(staffId!)}`);
  await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible();
  await adminPage.screenshot({
    path: testInfo.outputPath("staff-detail-1440.png"),
    fullPage: true,
  });

  const roleResponse = await adminPage.request.get("/api/admin/roles?limit=100");
  const roles = (await roleResponse.json()) as {
    ok: boolean;
    value?: { items: Array<{ roleId: string }> };
  };
  expect(roles.ok).toBe(true);
  const roleId = roles.value?.items[0]?.roleId;
  expect(roleId).toBeTruthy();
  await adminPage.goto(`/admin/staff/roles/${encodeURIComponent(roleId!)}`);
  await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible();
  await adminPage.screenshot({ path: testInfo.outputPath("role-detail-1440.png"), fullPage: true });
});

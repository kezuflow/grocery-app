import { expect, test } from "./admin-authenticated-fixture";

test("Admin overview reaches useful data through one browser bootstrap request", async ({
  adminPage,
}) => {
  const adminReads: string[] = [];
  const chartScripts: string[] = [];
  const fontRequests: string[] = [];
  adminPage.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/admin/bootstrap" ||
      url.pathname === "/api/admin/context" ||
      url.pathname === "/api/admin/scopes" ||
      url.pathname === "/api/admin/overview"
    ) {
      adminReads.push(url.pathname);
    }
    if (request.resourceType() === "script" && /admin-(?:bar|line)-chart/i.test(url.pathname)) {
      chartScripts.push(url.pathname);
    }
    if (request.resourceType() === "font") fontRequests.push(url.pathname);
  });

  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(adminPage.getByText("Open orders")).toBeVisible();
  await adminPage.evaluate(() => document.fonts.ready);

  expect(adminReads).toEqual(["/api/admin/bootstrap"]);
  expect(chartScripts).toEqual([]);
  expect(fontRequests.some((path) => /dm-sans-latin-wght-normal/i.test(path))).toBe(true);
  expect(fontRequests.some((path) => /(?:OpenSans|Outfit)-Latin/i.test(path))).toBe(false);
});

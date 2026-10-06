import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Select a seeded cycle even when a reused local D1 state has older cycle pages. */
export async function selectDeliveryWeek(page: Page, cycleId: string) {
  const select = page.getByRole("combobox", { name: "Delivery week", exact: true });
  await expect.poll(() => select.locator("option").count()).toBeGreaterThan(1);
  for (let index = 0; index < 50; index += 1) {
    if (await select.locator(`option[value="${cycleId}"]`).count()) {
      await select.selectOption(cycleId);
      return;
    }
    const more = page.getByRole("button", { name: "More delivery weeks" });
    await expect(more).toBeVisible();
    const priorCount = await select.locator("option").count();
    await more.click();
    await expect.poll(() => select.locator("option").count()).toBeGreaterThan(priorCount);
  }
  throw new Error("The test delivery week was not found in the paged cycle selector.");
}

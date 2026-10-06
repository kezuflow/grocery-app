import type { Page } from "@playwright/test";
import type {
  AdminContextView,
  AdminScopeOptionView,
  AdminSelectedScope,
} from "@freshmarkets/contracts";

export async function installAdminBootstrapFixture(
  page: Page,
  fixture: {
    context: AdminContextView;
    scopes: ReadonlyArray<AdminScopeOptionView>;
    selectedScope: AdminSelectedScope;
    timezone: string;
  },
) {
  await page.route("**/api/admin/bootstrap?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: "admin-bootstrap-fixture",
        value: {
          context: fixture.context,
          scopes: fixture.scopes,
          selection: {
            selectedScope: fixture.selectedScope,
            source: "SINGLE_ASSIGNMENT",
            requestedScopeAccepted: null,
            timezone: fixture.timezone,
          },
          overview: null,
        },
      }),
    }),
  );
}

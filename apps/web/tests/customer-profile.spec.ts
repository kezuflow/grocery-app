import { expect, test } from "./admin-authenticated-fixture";

test.describe.configure({ timeout: 180000 });
test.use({ actionTimeout: 15000 });

for (const width of [1440, 390]) {
  test(`customer preferences persist after a lost response at ${width}px`, async ({
    signedInPage,
  }, testInfo) => {
    await signedInPage.setViewportSize({ width, height: 900 });
    await signedInPage.goto("/account/profile");
    await expect(signedInPage.getByRole("heading", { name: "Your account details" })).toBeVisible();
    await signedInPage
      .getByRole("textbox", { name: "Your name", exact: true })
      .fill("Customer account test");
    await signedInPage.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(signedInPage.getByText("Name saved.", { exact: true })).toBeVisible();
    await signedInPage
      .getByRole("textbox", { name: "Account phone", exact: true })
      .fill("0917 123 4567");
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).not.toBeChecked();
    await signedInPage.getByRole("textbox", { name: "Preferred language" }).fill("Cebuano");
    await signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }).check();
    const requests: { key: string | undefined; body: string | null }[] = [];
    await signedInPage.route("**/api/commerce/profile", async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await signedInPage.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(signedInPage.getByRole("textbox", { name: "Preferred language" })).toBeDisabled();
    await signedInPage.getByRole("button", { name: "Retry saving preferences" }).click();
    await expect(signedInPage.getByText("Preferences saved.", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await signedInPage.reload();
    await expect(signedInPage.getByRole("textbox", { name: "Your name", exact: true })).toHaveValue(
      "Customer account test",
    );
    await expect(
      signedInPage.getByRole("textbox", { name: "Account phone", exact: true }),
    ).toHaveValue("+639171234567");
    await expect(signedInPage.getByRole("textbox", { name: "Preferred language" })).toHaveValue(
      "Cebuano",
    );
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).toBeChecked();
    await signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }).uncheck();
    await signedInPage.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(signedInPage.getByRole("status")).toContainText("Preferences saved");
    await signedInPage.reload();
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).not.toBeChecked();
    expect(
      await signedInPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await signedInPage.screenshot({
      path: testInfo.outputPath("customer-preferences.png"),
      fullPage: true,
    });

    const candidate = {
      candidateKey: "synthetic-account-address",
      displayAddress: "Test entrance, Cebu",
      coordinate: { latitude: 10.32, longitude: 123.9 },
      components: {
        addressLine1: "Test entrance",
        addressLine2: null,
        barangay: null,
        city: "Cebu",
        region: "Cebu",
        postalCode: null,
        countryCode: "PH",
      },
      accuracy: "rooftop",
    };
    await signedInPage.route("**/api/commerce/address-search", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, value: [candidate], requestId: "test-search" }),
      }),
    );
    await signedInPage.goto("/account/addresses");
    await expect(signedInPage.getByRole("textbox", { name: /^Phone number/ })).toHaveValue(
      "+639171234567",
    );
    await signedInPage
      .getByRole("textbox", { name: /^Search for an address/ })
      .fill("Test entrance");
    await signedInPage.getByRole("button", { name: candidate.displayAddress, exact: true }).click();
    await expect(signedInPage.getByText("Delivery is available", { exact: true })).toBeVisible();
    await signedInPage.getByRole("textbox", { name: /^Address label/ }).fill("Home");
    await signedInPage
      .getByRole("textbox", { name: "Recipient name", exact: true })
      .fill("Different recipient");
    await signedInPage.getByRole("textbox", { name: /^Phone number/ }).fill("0918 123 4567");
    await signedInPage
      .getByRole("textbox", { name: /^Delivery note/ })
      .fill("Synthetic delivery instruction");
    await signedInPage.getByRole("button", { name: "Save confirmed address", exact: true }).click();
    await expect(
      signedInPage.getByText("Delivery address saved and refreshed.", { exact: true }),
    ).toBeVisible();
    const commands: Array<{ key: string | undefined; body: string | null }> = [];
    await signedInPage.route("**/api/commerce/address/manage", async (route) => {
      commands.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (commands.length === 1) await route.abort();
      else await route.fulfill({ response });
    });
    await signedInPage.getByRole("button", { name: "Use Home as default", exact: true }).click();
    await signedInPage.getByRole("button", { name: "Retry address change", exact: true }).click();
    await expect(signedInPage.getByText("Default address saved.", { exact: true })).toBeVisible();
    expect(commands[1]).toEqual(commands[0]);
    await signedInPage.reload();
    await expect(signedInPage.getByText("Default address", { exact: true })).toBeVisible();
    await signedInPage.getByRole("button", { name: "Edit Home address", exact: true }).click();
    await expect(signedInPage.getByRole("textbox", { name: /^Phone number/ })).toHaveValue(
      "+639181234567",
    );
    await signedInPage
      .getByRole("textbox", { name: /^Delivery note/ })
      .fill("Updated synthetic instruction");
    await signedInPage
      .getByRole("button", { name: "Update confirmed address", exact: true })
      .click();
    await expect(
      signedInPage.getByText("Delivery address saved and refreshed.", { exact: true }),
    ).toBeVisible();
    await signedInPage.goto("/checkout");
    await expect(signedInPage.getByRole("radio", { name: /^Home/ })).toBeChecked();
    await signedInPage.goto("/account/addresses");
    await signedInPage.getByRole("button", { name: "Remove Home address", exact: true }).click();
    await expect(
      signedInPage.getByText("Address removed. Existing Orders keep their delivery details.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      signedInPage.getByText("No saved delivery addresses yet", { exact: true }),
    ).toBeVisible();
    await signedInPage.reload();
    await expect(
      signedInPage.getByText("No saved delivery addresses yet", { exact: true }),
    ).toBeVisible();
    await expect(signedInPage.getByRole("textbox", { name: /^Phone number/ })).toHaveValue(
      "+639171234567",
    );
    await signedInPage.screenshot({
      path: testInfo.outputPath(`ca76-address-book-${width}.png`),
      fullPage: true,
    });
  });
}

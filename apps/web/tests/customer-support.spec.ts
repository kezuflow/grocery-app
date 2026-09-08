import { expect, test } from "./admin-authenticated-fixture";
for (const width of [1440, 390]) {
  test(`Global customer preferences and support notes recover at ${width}px`, async ({
    adminPage,
    signedInPage,
  }, testInfo) => {
    await signedInPage.goto("/account/profile");
    await expect(signedInPage.getByRole("heading", { name: "Your preferences" })).toBeVisible();
    const session = await (await signedInPage.request.get("/api/auth/get-session")).json();
    await adminPage.setViewportSize({ width, height: 900 });
    await adminPage.goto("/admin/customers");
    const customers = await (
      await adminPage.request.get(
        `/api/admin/customers?query=${encodeURIComponent(session.user.email)}`,
      )
    ).json();
    expect(customers).toMatchObject({ ok: true });
    const customerId = customers.value.items.find(
      (item: { email: string }) => item.email === session.user.email,
    )?.customerId;
    expect(customerId).toBeTruthy();
    await adminPage.goto(`/admin/customers/${customerId}`);
    await adminPage
      .getByRole("textbox", { name: "Preferred language", exact: true })
      .fill("Cebuano");
    await adminPage
      .getByRole("textbox", { name: "Preference change reason" })
      .fill("Customer requested Cebuano support and promotional emails.");
    await adminPage.getByRole("checkbox", { name: "Receive promotional emails" }).check();
    const edits: { body: string | null; key: string | undefined }[] = [];
    await adminPage.route(`**/api/admin/customers/${customerId}/profile`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      edits.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (edits.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage.getByRole("button", { name: "Save customer preferences" }).click();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(
      adminPage.getByRole("textbox", { name: "Preferred language", exact: true }),
    ).toHaveValue("Cebuano");
    expect(edits).toHaveLength(2);
    expect(edits[1]).toEqual(edits[0]);
    await signedInPage.reload();
    await expect(signedInPage.getByRole("textbox", { name: "Preferred language" })).toHaveValue(
      "Cebuano",
    );
    await expect(
      signedInPage.getByRole("checkbox", { name: "Receive promotional emails" }),
    ).toBeChecked();
    const notes: { body: string | null; key: string | undefined }[] = [];
    await adminPage.route(`**/api/admin/customers/${customerId}/notes*`, async (route) => {
      if (route.request().method() === "GET") {
        const url = new URL(route.request().url());
        url.searchParams.set("limit", "1");
        return route.fulfill({ response: await route.fetch({ url: url.toString() }) });
      }
      notes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(await response.json()).toMatchObject({ ok: true });
      if (notes.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await adminPage
      .getByRole("textbox", { name: "New support note" })
      .fill("Customer asked us to follow the saved delivery instructions.");
    await adminPage.getByRole("button", { name: "Add support note" }).click();
    await expect(
      adminPage.getByRole("textbox", { name: "Preferred language", exact: true }),
    ).toBeDisabled();
    await adminPage.getByRole("button", { name: "Retry unconfirmed action" }).click();
    await expect(
      adminPage.getByText("Customer asked us to follow the saved delivery instructions.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(notes).toHaveLength(2);
    expect(notes[1]).toEqual(notes[0]);
    await adminPage
      .getByRole("textbox", { name: "New support note" })
      .fill("Follow-up: customer confirmed the instructions.");
    await adminPage.getByRole("button", { name: "Add support note" }).click();
    await expect(
      adminPage.getByText("Follow-up: customer confirmed the instructions.", { exact: true }),
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Load more support notes" }).click();
    await expect(
      adminPage.getByText("Customer asked us to follow the saved delivery instructions.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await adminPage.screenshot({
      path: testInfo.outputPath("customer-support-notes.png"),
      fullPage: true,
    });
  });
}

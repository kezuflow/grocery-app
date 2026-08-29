import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";

const coreRoot = fileURLToPath(new URL("../../core", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../../core/node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const appBaseUrl =
  process.env.E2E_START_STACK === "1"
    ? "http://localhost:3100"
    : (process.env.APP_BASE_URL ?? "http://localhost:3000");
const authenticatedFixtureEnabled =
  process.env.E2E_AUTHENTICATED === "1" || process.env.E2E_START_STACK === "1";

type AdminFixtures = {
  adminPage: Page;
  deniedAdminPage: Page;
  signedInPage: Page;
};

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function executeAdminE2eSql(sql: string): void {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        ".wrangler/e2e-state",
        "--command",
        sql,
      ],
      {
        cwd: coreRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        shell: false,
      },
    );
    if (result.status === 0) return;
    const output = `${result.stdout}\n${result.stderr}`;
    if (!output.includes("SQLITE_BUSY") || attempt === 5) {
      throw new Error(
        `Unable to provision the local Admin fixture (exit ${result.status ?? "unknown"}).\n${output}`,
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 100);
  }
}

async function provisionAccount(page: Page, access: "admin" | "denied"): Promise<void> {
  const suffix = crypto.randomUUID();
  const email = `admin-e2e-${access}-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { "content-type": "application/json", origin: appBaseUrl },
    data: { name: `Admin E2E ${access}`, email, password },
  });
  if (![200, 201].includes(signUp.status())) {
    throw new Error(
      `Admin fixture signup failed with HTTP ${signUp.status()}. Start the E2E stack with ENVIRONMENT=test. ${await signUp.text()}`,
    );
  }

  const emailSql = sqlLiteral(email);
  const staffId = sqlLiteral(`staff-e2e-${suffix}`);
  const roleId = sqlLiteral(`role-e2e-${suffix}`);
  const scopeId = sqlLiteral(`scope-e2e-${suffix}`);
  const now = Date.now();
  const capabilityGrant =
    access === "admin"
      ? `INSERT INTO role_permission (role_id, permission_id) SELECT ${roleId}, id FROM permission WHERE code LIKE '%.%';`
      : "";
  executeAdminE2eSql(`
    UPDATE user SET email_verified=1, updated_at=${now} WHERE email=${emailSql};
    INSERT INTO role (id, code, name, description, status, version, created_at)
      VALUES (${roleId}, ${sqlLiteral(`e2e_${access}_${suffix}`)}, ${sqlLiteral(`E2E ${access}`)}, 'Playwright fixture', 'ACTIVE', 1, ${now});
    INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at, version)
      SELECT ${staffId}, id, ${sqlLiteral(`E2E ${access}`)}, 'active', ${now}, ${now}, 1 FROM user WHERE email=${emailSql};
    INSERT INTO staff_role (staff_id, role_id) VALUES (${staffId}, ${roleId});
    INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id)
      VALUES (${scopeId}, ${staffId}, 'global', NULL, NULL);
    ${capabilityGrant}
  `);

  const signIn = await page.request.post("/api/auth/sign-in/email", {
    headers: { "content-type": "application/json", origin: appBaseUrl },
    data: { email, password },
  });
  if (signIn.status() >= 400) {
    throw new Error(
      `Admin fixture signin failed with HTTP ${signIn.status()}: ${await signIn.text()}`,
    );
  }
}

export const test = base.extend<AdminFixtures>({
  adminPage: async ({ browser }, use) => {
    test.skip(
      !authenticatedFixtureEnabled,
      "Set E2E_AUTHENTICATED=1 and start the deterministic local E2E stack.",
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await provisionAccount(page, "admin");
    await use(page);
    await context.close();
  },
  deniedAdminPage: async ({ browser }, use) => {
    test.skip(
      !authenticatedFixtureEnabled,
      "Set E2E_AUTHENTICATED=1 and start the deterministic local E2E stack.",
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await provisionAccount(page, "denied");
    await use(page);
    await context.close();
  },
  signedInPage: async ({ browser }, use) => {
    test.skip(
      !authenticatedFixtureEnabled,
      "Set E2E_AUTHENTICATED=1 and start the deterministic local E2E stack.",
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    const suffix = crypto.randomUUID();
    const email = `admin-e2e-account-${suffix}@example.com`;
    const password = "correct-horse-battery-staple";
    const signUp = await page.request.post("/api/auth/sign-up/email", {
      headers: { "content-type": "application/json", origin: appBaseUrl },
      data: { name: "E2E account", email, password },
    });
    expect([200, 201]).toContain(signUp.status());
    executeAdminE2eSql(
      `UPDATE user SET email_verified=1, updated_at=${Date.now()} WHERE email=${sqlLiteral(email)};`,
    );
    const signIn = await page.request.post("/api/auth/sign-in/email", {
      headers: { "content-type": "application/json", origin: appBaseUrl },
      data: { email, password },
    });
    expect(signIn.status()).toBeLessThan(400);
    await use(page);
    await context.close();
  },
});

export { expect };

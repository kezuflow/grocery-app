import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isDocumentationPathCompliant,
  isAppRouteGroupDirectory,
  isMobileExpoRouteFile,
} from "./verify-naming.mjs";

const verifier = fileURLToPath(new URL("./verify-naming.mjs", import.meta.url));

test("allows route groups only beneath the Web and Mobile app routers", () => {
  assert.equal(isAppRouteGroupDirectory("apps/web/app/(storefront)"), true);
  assert.equal(isAppRouteGroupDirectory("apps/web/app/admin/(read-only)"), true);
  assert.equal(isAppRouteGroupDirectory("apps/web/components/(storefront)"), false);
  assert.equal(isAppRouteGroupDirectory("apps/web/app/(Storefront)"), false);
  assert.equal(isAppRouteGroupDirectory("apps/web/app/(store_front)"), false);
  assert.equal(isAppRouteGroupDirectory("apps/mobile/app/(tabs)"), true);
  assert.equal(isAppRouteGroupDirectory("apps/mobile/components/(tabs)"), false);
  assert.equal(isAppRouteGroupDirectory("apps/mobile/app/(Tabs)"), false);
  assert.equal(isAppRouteGroupDirectory("mobile/app/(tabs)"), false);
});

test("allows Expo's required layout filename only beneath mobile routes", () => {
  assert.equal(isMobileExpoRouteFile("apps/mobile/app/_layout.tsx"), true);
  assert.equal(isMobileExpoRouteFile("apps/mobile/app/(tabs)/_layout.tsx"), true);
  assert.equal(isMobileExpoRouteFile("apps/mobile/app/+not-found.tsx"), true);
  assert.equal(isMobileExpoRouteFile("apps/mobile/components/_layout.tsx"), false);
  assert.equal(isMobileExpoRouteFile("apps/mobile/app/_helper.tsx"), false);
  assert.equal(isMobileExpoRouteFile("apps/mobile/app/+secret.tsx"), false);
  assert.equal(isMobileExpoRouteFile("mobile/app/_layout.tsx"), false);
  assert.equal(isMobileExpoRouteFile("apps/web/app/_layout.tsx"), false);
});

test("ignores generated test results and linked worktree metadata", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "freshmarkets-naming-"));
  try {
    await writeFile(join(fixtureRoot, "package.json"), '{"name":"freshmarkets","private":true}');
    await mkdir(join(fixtureRoot, "apps", "web", "test-results", "Generated Result"), {
      recursive: true,
    });
    await mkdir(join(fixtureRoot, ".worktrees", "linked"), { recursive: true });
    await writeFile(
      join(fixtureRoot, ".worktrees", "linked", "package.json"),
      '{"name":"freshmarkets","private":true}',
    );

    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot,
      encoding: "utf8",
      shell: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("ignores Expo-generated projects while enforcing authored mobile source", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "freshmarkets-naming-native-"));
  const run = () => spawnSync(process.execPath, [verifier], { cwd: fixtureRoot, encoding: "utf8" });
  try {
    await writeFile(join(fixtureRoot, "package.json"), '{"name":"freshmarkets","private":true}');
    for (const platform of ["android", "ios"]) {
      const generated = join(fixtureRoot, "apps", "mobile", platform, "Generated Project");
      await mkdir(generated, { recursive: true });
      await writeFile(join(generated, "Contents.json"), "{}");
    }
    const valid = run();
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    const authored = join(fixtureRoot, "apps", "mobile", "lib");
    await mkdir(authored, { recursive: true });
    await writeFile(join(authored, "WrongName.ts"), "export {};");
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /apps\/mobile\/lib\/WrongName\.ts/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("ignores agent skill metadata while enforcing visible package names", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "freshmarkets-naming-skills-"));
  const webPackage = join(fixtureRoot, "apps", "web", "package.json");
  const contractsPackage = join(fixtureRoot, "packages", "contracts", "package.json");
  const run = () =>
    spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot,
      encoding: "utf8",
      shell: false,
    });

  try {
    await writeFile(join(fixtureRoot, "package.json"), '{"name":"freshmarkets","private":true}');
    await mkdir(join(fixtureRoot, ".agents", "skills", "workflow", "scripts"), {
      recursive: true,
    });
    await writeFile(
      join(fixtureRoot, ".agents", "skills", "workflow", "scripts", "package.json"),
      '{"name":"@cursor-skill/workflow-tools","private":true}',
    );
    await mkdir(join(fixtureRoot, "apps", "web"), { recursive: true });
    await mkdir(join(fixtureRoot, "packages", "contracts"), { recursive: true });
    await writeFile(webPackage, '{"name":"@freshmarkets/web","private":true}');
    await writeFile(contractsPackage, '{"name":"@freshmarkets/contracts","private":true}');

    const valid = run();
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);

    await writeFile(webPackage, '{"name":"web","private":true}');
    const invalidApp = run();
    assert.equal(invalidApp.status, 1);
    assert.match(invalidApp.stderr, /apps\/web\/package\.json: workspace package names/);

    await writeFile(webPackage, '{"name":"@freshmarkets/web","private":true}');
    await writeFile(contractsPackage, '{"name":"contracts","private":true}');
    const invalidLibrary = run();
    assert.equal(invalidLibrary.status, 1);
    assert.match(
      invalidLibrary.stderr,
      /packages\/contracts\/package\.json: workspace package names/,
    );

    await writeFile(contractsPackage, '{"name":"@freshmarkets/contracts","private":true}');
    await mkdir(join(fixtureRoot, ".github", "tools"), { recursive: true });
    await writeFile(
      join(fixtureRoot, ".github", "tools", "package.json"),
      '{"name":"tools","private":true}',
    );
    const invalidGithubPackage = run();
    assert.equal(invalidGithubPackage.status, 1);
    assert.match(
      invalidGithubPackage.stderr,
      /\.github\/tools\/package\.json: workspace package names/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("allows dated Superpowers plans without weakening canonical document names", () => {
  assert.equal(isDocumentationPathCompliant("docs/architecture/API_CONTRACTS.md"), true);
  assert.equal(
    isDocumentationPathCompliant(
      "docs/superpowers/plans/2026-08-31-freshmarkets-admin-shadcnuikit-redesign.md",
    ),
    true,
  );
  assert.equal(isDocumentationPathCompliant("docs/architecture/api-contracts.md"), false);
  assert.equal(isDocumentationPathCompliant("docs/product/product-scope.md"), false);
});

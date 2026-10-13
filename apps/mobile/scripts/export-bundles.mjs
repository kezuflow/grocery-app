import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mobileRoot, repositoryRoot } from "./native-driver.mjs";

const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");

for (const target of ["android", "ios"]) {
  const args = [
    expoCli,
    "export",
    "--platform",
    target,
    "--output-dir",
    join(repositoryRoot, ".wrangler", "mobile-bundles", target),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: mobileRoot,
    env: {
      ...process.env,
      EXPO_PUBLIC_APP_VARIANT: "development",
      EXPO_PUBLIC_BACKEND_ORIGIN: "http://localhost:3100",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) {
    process.exitCode = result.error ? 1 : (result.status ?? 1);
    break;
  }
}

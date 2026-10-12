import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { commandInvocation, mobileRoot, repositoryRoot } from "./native-driver.mjs";

for (const target of ["android", "ios"]) {
  const invocation = commandInvocation("pnpm", [
    "exec",
    "expo",
    "export",
    "--platform",
    target,
    "--output-dir",
    join(repositoryRoot, ".wrangler", "mobile-bundles", target),
  ]);
  const result = spawnSync(invocation.executable, invocation.args, {
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

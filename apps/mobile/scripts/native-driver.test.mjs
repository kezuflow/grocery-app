import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  command,
  commandInvocation,
  mobileRoot,
  parseOptions,
  validateBackend,
} from "./native-driver.mjs";
import { parseColdStart, summarizeTrials } from "./performance-probe.mjs";

test("journey requires explicit platform and device, and rejects remote origins and embedded credentials", () => {
  const args = [
    "--platform",
    "android",
    "--device",
    "emulator-5554",
    "--backend-origin",
    "http://10.0.2.2:3100",
    "--backend-host-origin",
    "http://127.0.0.1:3100",
  ];
  assert.deepEqual(parseOptions(args), {
    lane: "shell",
    platform: "android",
    device: "emulator-5554",
    "backend-origin": "http://10.0.2.2:3100",
    "backend-host-origin": "http://127.0.0.1:3100",
  });
  assert.throws(() => parseOptions(args.slice(2)), /platform/);
  assert.throws(
    () => parseOptions(args.filter((_, index) => index !== 2 && index !== 3)),
    /device/,
  );
  assert.throws(
    () =>
      parseOptions(
        args.map((value) =>
          value === "http://10.0.2.2:3100" ? "https://core.freshmarkets.ph" : value,
        ),
      ),
    /HTTP origin/,
  );
  assert.throws(
    () =>
      parseOptions(
        args.map((value) =>
          value === "http://10.0.2.2:3100" ? "http://secret@10.0.2.2:3100" : value,
        ),
      ),
    /credentials/,
  );
  assert.throws(() => parseOptions([...args, "--unknown", "true"]), /Use --platform/);
});

test("Core liveness rejects an unbound database and production environment", () => {
  const health = {
    service: "core",
    status: "ok",
    environment: "development",
    databaseBindingConfigured: true,
    contractVersion: "v1",
  };
  assert.deepEqual(validateBackend(health), {
    environment: "development",
    databaseBindingConfigured: true,
    contractVersion: "v1",
    acceptance: "Core liveness only. Database execution and commerce readiness are not proved.",
  });
  assert.throws(
    () => validateBackend({ ...health, databaseBindingConfigured: false }),
    /D1 binding/,
  );
  assert.throws(
    () => validateBackend({ ...health, environment: "production" }),
    /development Core/,
  );
  assert.throws(() => validateBackend({ ...health, contractVersion: "" }), /development Core/);
});

test(
  "Windows command invocation quotes paths and rejects shell expansion",
  { skip: platform() !== "win32" },
  () => {
    assert.deepEqual(
      commandInvocation("maestro", ["test", "C:\\workspace with spaces\\shell.yaml"]),
      {
        executable: "cmd.exe",
        args: ["/d", "/s", "/c", 'maestro "test" "C:\\workspace with spaces\\shell.yaml"'],
        windowsVerbatimArguments: true,
      },
    );
    assert.throws(() => commandInvocation("maestro", ["%TOKEN%"]), /Unsafe Windows/);
    assert.throws(
      () => commandInvocation("maestro", ["shell.yaml & echo unsafe"]),
      /Unsafe Windows/,
    );
  },
);

const expected = {
  appId: "ph.freshmarkets.customer.development",
  backendOrigin: "http://10.0.2.2:8787",
};

test(
  "Windows launcher preserves actual CLI arguments with spaces",
  { skip: platform() !== "win32" },
  () => {
    const fixture = mkdtempSync(join(tmpdir(), "fm-mobile-cli-"));
    const previousPath = process.env.PATH;
    try {
      writeFileSync(
        join(fixture, "arguments.cjs"),
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
      );
      writeFileSync(
        join(fixture, "maestro.cmd"),
        `@echo off\r\n"${process.execPath}" "${join(fixture, "arguments.cjs")}" %*\r\n`,
      );
      process.env.PATH = `${fixture};${previousPath ?? ""}`;
      assert.equal(
        command("maestro", ["test", "C:\\workspace with spaces\\shell.yaml"]),
        '["test","C:\\\\workspace with spaces\\\\shell.yaml"]',
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
function timingLog(launchId = "launch-1") {
  const identity = {
    platform: "android",
    buildVariant: "development",
    backendOrigin: expected.backendOrigin,
    launchId,
  };
  return [
    `100.000  100 100 I ActivityTaskManager: START u0 {cmp=${expected.appId}/.MainActivity}`,
    `100.250  200 200 I ReactNativeJS: FM_PERF ${JSON.stringify({ ...identity, mark: "shell-ready", elapsedMs: 120 })}`,
    `100.500  200 200 I ReactNativeJS: FM_PERF ${JSON.stringify({ ...identity, mark: "backend-ready", elapsedMs: 370 })}`,
  ].join("\n");
}

test("cold timing uses device monotonic launch and semantic readiness, without counting driver startup", () => {
  assert.deepEqual(parseColdStart(timingLog(), expected), {
    launchId: "launch-1",
    nativeShellMs: 250,
    customerReadyMs: 500,
    jsShellMs: 120,
    jsBackendMs: 370,
  });
  assert.throws(
    () => parseColdStart(timingLog().replace("shell-ready", "loading"), expected),
    /rendered shell mark/,
  );
  assert.throws(
    () =>
      parseColdStart(timingLog().replace("http://10.0.2.2:8787", "http://10.0.2.2:9999"), expected),
    /expected development build/,
  );
  assert.throws(
    () => parseColdStart(timingLog().replace('"elapsedMs":120', '"elapsedMs":-1'), expected),
    /nonnegative/,
  );
  assert.throws(
    () => parseColdStart(timingLog().replace("100.250", "99.250"), expected),
    /stale process/,
  );
  assert.throws(
    () =>
      parseColdStart(
        timingLog().replace(
          '"launchId":"launch-1","mark":"backend-ready"',
          '"launchId":"launch-2","mark":"backend-ready"',
        ),
        expected,
      ),
    /stale process/,
  );
});

test("performance acceptance requires thirty independent complete cold trials and enforces budgets", () => {
  const trials = Array.from({ length: 30 }, (_, index) =>
    parseColdStart(timingLog(`launch-${index}`), expected),
  );
  assert.deepEqual(summarizeTrials(trials), {
    trials: 30,
    nativeShellP95Ms: 250,
    customerReadyP95Ms: 500,
    jsShellP95Ms: 120,
    jsBackendP95Ms: 370,
  });
  assert.throws(() => summarizeTrials(trials.slice(1)), /thirty/);
  assert.throws(
    () => summarizeTrials(trials.map((trial) => ({ ...trial, launchId: "same" }))),
    /fresh process/,
  );
  assert.throws(
    () => summarizeTrials(trials.map((trial) => ({ ...trial, nativeShellMs: 1001 }))),
    /budgets exceeded/,
  );
  assert.throws(
    () => summarizeTrials(trials.map((trial) => ({ ...trial, customerReadyMs: 5001 }))),
    /budgets exceeded/,
  );
});

test("the public command fails before driving without native prerequisites", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-journey.mjs", "--platform", "browser"],
    { cwd: mobileRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Select --platform android or ios/);
  assert.equal(result.stdout, "");
});

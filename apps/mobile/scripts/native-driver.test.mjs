import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  command,
  commandAsync,
  collectOutput,
  commandInvocation,
  mobileRoot,
  parseOptions,
  validateBackend,
  trialTimingLog,
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
  assert.throws(
    () =>
      parseOptions(
        args.map((value) => (value === "http://10.0.2.2:3100" ? "http://192.168.1.8:3100" : value)),
      ),
    /LAN backend identity is unproved/,
  );
  assert.throws(
    () =>
      parseOptions(
        args.map((value) => (value === "http://127.0.0.1:3100" ? "http://127.0.0.1:3101" : value)),
      ),
    /matching emulator/,
  );
});

test("timing evidence excludes buffered historical trials and marks from another process", () => {
  const log = [
    timingLog("stale"),
    "101.000 300 300 I FreshMarketsProbe: live-fence",
    timingLog("current").replaceAll("100.", "102."),
    '102.900 999 999 I ReactNativeJS: FM_PERF {"launchId":"another-process"}',
  ].join("\n");
  const observed = trialTimingLog(log, { fence: "live-fence", pid: "200" });
  assert.doesNotMatch(observed, /stale|another-process|FreshMarketsProbe/);
  assert.equal(parseColdStart(observed, expected).launchId, "current");
  assert.throws(
    () => trialTimingLog(log, { fence: "missing-fence", pid: "200" }),
    /live launch fence/,
  );
});

test("output capture waits for process closure and drains the final stdout bytes", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.stdout.write('first'); setTimeout(() => process.stdout.end('-final'), 30);"],
    { windowsHide: true },
  );
  const output = collectOutput(child);
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(await output.stop(), "first-final");
});

test("an interrupted asynchronous driver drains output and rejects before cleanup continues", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("driver interrupted")), 500);
  try {
    await assert.rejects(
      commandAsync(
        process.execPath,
        ["-e", "process.stdout.write('driver-started'); setInterval(() => {}, 1000);"],
        { signal: controller.signal },
      ),
      (error) => {
        assert.equal(error.message, "driver interrupted");
        assert.match(error.commandOutput, /driver-started/);
        return true;
      },
    );
  } finally {
    clearTimeout(timer);
  }
});

test(
  "owned recorder cleanup delivers SIGINT and waits for its process group to disappear",
  { skip: platform() === "win32" ? "Recorder process groups require a POSIX host." : false },
  async () => {
    const { stopOwnedProcessGroup } = await import("./native-driver.mjs");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGINT', () => { process.stdout.write('recorder-flushed'); process.exit(0); }); process.stdout.write('recorder-ready'); setInterval(() => {}, 1000);",
      ],
      { detached: true },
    );
    const output = collectOutput(child);
    let startTimer;
    const started = new Promise((resolve, reject) => {
      startTimer = setTimeout(
        () => reject(new Error("The recorder fixture did not start.")),
        5_000,
      );
      child.stdout.once("data", resolve);
      child.once("error", reject);
    }).finally(() => clearTimeout(startTimer));
    try {
      await started;
      await stopOwnedProcessGroup(child, "SIGINT");
      assert.equal(await output.stop(), "recorder-readyrecorder-flushed");
      assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
    } finally {
      await stopOwnedProcessGroup(child, "SIGKILL");
    }
  },
);

test(
  "Darwin cleanup waits for an observed zombie-only group to be reaped",
  { skip: platform() !== "darwin" ? "The zombie-only EPERM race requires Darwin." : false },
  async (context) => {
    const kill = process.kill.bind(process);
    const controller = new AbortController();
    let group;
    let census;
    context.mock.method(process, "kill", (pid, signal) => {
      const result = kill(pid, signal);
      if (pid < 0 && signal === "SIGTERM" && !group) {
        group = -pid;
        const deadline = performance.now() + 2_000;
        while (performance.now() < deadline) {
          const observed = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], {
            encoding: "utf8",
            timeout: 1_000,
          });
          assert.equal(observed.status, 0);
          const members = observed.stdout
            .trim()
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/))
            .filter((row) => Number(row[1]) === group);
          if (members.length && members.every((row) => row[2].startsWith("Z"))) {
            census = members.map(([pid, pgid, stat]) => ({
              pid: Number(pid),
              pgid: Number(pgid),
              stat,
            }));
            assert.throws(() => kill(-group, 0), { code: "EPERM" });
            context.diagnostic(JSON.stringify({ observedKernelError: "EPERM", census }));
            break;
          }
        }
        assert.ok(census, "The actual kernel must expose the zombie-only group before reaping.");
      }
      return result;
    });
    const timer = setTimeout(() => controller.abort(new Error("zombie trial interrupted")), 500);
    let primaryFailure;
    let cleanupFailure;
    try {
      await assert.rejects(
        commandAsync(
          process.execPath,
          ["-e", "process.stdout.write('zombie-trial-ready'); setInterval(() => {}, 1000);"],
          { signal: controller.signal },
        ),
        (error) => {
          context.diagnostic(
            JSON.stringify({
              observedCommandRejection: error.message,
              cleanupCode: error.errors?.[1]?.code,
            }),
          );
          assert.equal(error.message, "zombie trial interrupted");
          assert.match(error.commandOutput, /zombie-trial-ready/);
          return true;
        },
      );
      assert.throws(() => kill(-group, 0), { code: "ESRCH" });
      context.diagnostic(JSON.stringify({ group, finalKernelError: "ESRCH" }));
    } catch (error) {
      primaryFailure = error;
    } finally {
      clearTimeout(timer);
      context.mock.restoreAll();
      if (group) {
        try {
          context.diagnostic(
            JSON.stringify({ group, fixtureCleanup: "current-helper-after-measurement" }),
          );
          const { stopOwnedProcessGroup } = await import("./native-driver.mjs");
          await stopOwnedProcessGroup({ pid: group }, "SIGKILL");
          assert.throws(() => kill(-group, 0), { code: "ESRCH" });
          context.diagnostic(JSON.stringify({ group, fixtureCleanupResult: "ESRCH" }));
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
      }
    }
    if (primaryFailure && cleanupFailure)
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        `${primaryFailure.message} Fixture cleanup also failed. ${cleanupFailure.message}`,
      );
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
  },
);

test(
  "Darwin cleanup rejects EPERM when the owned process census still has a live member",
  { skip: platform() !== "darwin" ? "Darwin owns the EPERM census behavior." : false },
  async (context) => {
    const kill = process.kill.bind(process);
    let group;
    context.mock.method(process, "kill", (pid, signal) => {
      if (pid < 0 && signal === "SIGTERM") {
        group = -pid;
        const error = new Error("fixture permission denied");
        error.code = "EPERM";
        throw error;
      }
      return kill(pid, signal);
    });
    try {
      await assert.rejects(
        commandAsync(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
          timeout: 500,
        }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          const cleanupError = error.errors[1];
          assert.equal(cleanupError.code, "EPERM");
          assert.equal(cleanupError.cause.message, "fixture permission denied");
          assert.ok(cleanupError.processGroupCensus.some((row) => !row.stat.startsWith("Z")));
          return true;
        },
      );
    } finally {
      context.mock.restoreAll();
      if (group) kill(-group, "SIGKILL");
    }
  },
);

for (const interruption of ["abort", "timeout"])
  test(
    `${interruption} waits for a TERM-ignoring descendant after its process-group leader exits`,
    {
      skip: platform() === "win32" ? "POSIX process-group behavior requires a POSIX host." : false,
    },
    async () => {
      const fixture = mkdtempSync(join(tmpdir(), "fm-mobile-process-group-"));
      const identityPath = join(fixture, "identity.json");
      const controller = new AbortController();
      const descendant = [
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);",
        "process.send({ pid: process.pid });",
      ].join("\n");
      const leader = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });`,
        "child.once('message', ({ pid }) => {",
        `writeFileSync(${JSON.stringify(identityPath)}, JSON.stringify({ group: process.pid, descendant: pid }));`,
        "process.stdout.write('descendant-ready');",
        "});",
        "setInterval(() => {}, 1000);",
      ].join("\n");
      let identity;
      const result = commandAsync(process.execPath, ["-e", leader], {
        signal: controller.signal,
        timeout: 5_000,
      }).then(
        () => ({ succeeded: true }),
        (error) => ({ error }),
      );
      try {
        const deadline = Date.now() + 4_000;
        while (!existsSync(identityPath) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        identity = JSON.parse(readFileSync(identityPath, "utf8"));
        assert.ok(Number.isInteger(identity.group) && identity.group > 0);
        assert.ok(Number.isInteger(identity.descendant) && identity.descendant > 0);
        process.kill(identity.descendant, 0);
        if (interruption === "abort") controller.abort(new Error("group interrupted"));
        const observed = await result;
        assert.equal(
          observed.error?.message,
          interruption === "abort" ? "group interrupted" : `${process.execPath} timed out.`,
        );
        assert.match(observed.error.commandOutput, /descendant-ready/);
        assert.throws(() => process.kill(-identity.group, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(identity.descendant, 0), { code: "ESRCH" });
      } finally {
        controller.abort(new Error("fixture cleanup"));
        await result;
        if (identity) {
          try {
            process.kill(-identity.group, "SIGKILL");
          } catch (error) {
            assert.equal(error.code, "ESRCH");
          }
        }
        assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

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

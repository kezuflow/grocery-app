import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  appId,
  mobileRoot,
  preflight,
  repositoryRoot,
  runFlow,
  validateBackend,
} from "./native-driver.mjs";
import { prepareIosTiming, runIosColdTrial } from "./ios-performance-transport.mjs";

const platform = process.argv[2];
if (!["android", "ios"].includes(platform) || process.platform === "win32")
  throw new Error("Use run-native-ci.mjs android|ios on a POSIX CI runner.");
if (process.env.CI !== "true") throw new Error("This runner requires an isolated CI checkout.");
for (const path of ["apps/core/.dev.vars", "apps/web/.dev.vars", "apps/mobile/.env.local"])
  if (existsSync(join(repositoryRoot, path)))
    throw new Error(`Refusing private local input ${path}.`);
const require = createRequire(join(mobileRoot, "package.json"));
const expo = require.resolve("expo/bin/cli");
const wrangler = join(repositoryRoot, "apps/web/node_modules/wrangler-e2e/bin/wrangler.js");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const stateName = `e2e-native-${randomUUID()}`;
const stateRoot = resolve(repositoryRoot, "apps/core/.wrangler");
const stateDirectory = join(stateRoot, stateName);
const directory = join(
  repositoryRoot,
  ".wrangler/swarm/MOBILE-20261012.1.FOUNDATION",
  `${platform}-ci-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const receipt = {
  sha,
  platform,
  stateName,
  device: undefined,
  ownedProcessIDs: [],
  readiness: [],
  status: "running",
  startedAt: new Date().toISOString(),
  limits:
    "Installed development shell, Android cold-start gate, and one iOS clock smoke only. No physical devices, accessibility, complete iOS performance, or commerce acceptance.",
  cleanup: {},
};
const children = new Set();
let simulator;
let mapping;
let recorder;
let recordingStarted;
let recordingTimer;
let recordingStop;
let stateOwned = false;
let options;
let interrupted = false;
const controller = new AbortController();
const deviceVideo = `/sdcard/${stateName}.mp4`;
const env = {
  ...process.env,
  CI: "1",
  EXPO_NO_DEV_MENU: "1",
  EXPO_NO_METRO_LAZY: "1",
  EXPO_UNSTABLE_HEADLESS: "1",
  EXPO_PUBLIC_APP_VARIANT: "development",
  EXPO_PUBLIC_BACKEND_ORIGIN:
    platform === "android" ? "http://10.0.2.2:3100" : "http://127.0.0.1:3100",
  FM_NATIVE_EVIDENCE: join(directory, "served-bundles.jsonl"),
  FM_NATIVE_SOURCE_SHA: sha,
  E2E_AUTHENTICATED: "1",
  E2E_STATE_NAME: stateName,
  E2E_PROVIDER_GATEWAY: "0",
  FRESHMARKETS_DEV_DATA: "local",
  GRADLE_OPTS: "-Dorg.gradle.daemon=false",
  WRANGLER_SEND_METRICS: "false",
  MAESTRO_CLI_NO_ANALYTICS: "1",
};
const save = () =>
  writeFile(join(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
const start = (name, executable, args, cwd = repositoryRoot) => {
  const log = createWriteStream(join(directory, `${name}.log`));
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("close", () => {
    child.finishedAt = Date.now();
    log.end();
  });
  child.on("error", (error) => {
    child.failure = error;
  });
  children.add(child);
  receipt.ownedProcessIDs.push({ name, pid: child.pid });
  return child;
};
const stop = async (child, signal = "SIGTERM") => {
  if (!child?.pid) return;
  const alive = () => {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  if (!alive()) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 10_000;
  while (alive() && Date.now() < deadline) await delay(100);
  if (alive()) {
    process.kill(-child.pid, "SIGKILL");
    const killDeadline = Date.now() + 5000;
    while (alive() && Date.now() < killDeadline) await delay(100);
    if (alive()) throw new Error(`Owned process group ${child.pid} remains alive.`);
  }
};
const run = async (name, executable, args, cwd) => {
  const child = start(name, executable, args, cwd);
  const status = await new Promise((resolve) => {
    child.once("error", () => resolve(-1));
    child.once("close", resolve);
  });
  if (status !== 0) throw new Error(`${name} failed with exit ${status}; inspect ${name}.log.`);
};
const command = (executable, args) =>
  execFileSync(executable, args, {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
const reserve = (port) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(new Error(`Port ${port} is occupied; refusing to reuse it.`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
const waitFor = async (child, url, validate, timeout = 180_000) => {
  const deadline = Date.now() + timeout;
  const observation = { url, attempts: 0, status: "waiting" };
  receipt.readiness.push(observation);
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Native CI runner interrupted.");
    if (child.failure || child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Owned server exited before ${url} became ready.`);
    try {
      observation.attempts += 1;
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
      observation.lastHttpStatus = response.status;
      if (response.ok) {
        const result = await validate(response);
        observation.status = "ready";
        return result;
      }
    } catch (error) {
      observation.lastError = { message: error.message, causeCode: error.cause?.code };
    }
    await delay(1000);
  }
  observation.status = "timed-out";
  throw new Error(
    `Owned server did not become ready at ${url}. ${observation.lastError?.message ?? "No successful response."}`,
  );
};
const stopRecording = () =>
  (recordingStop ??= (async () => {
    if (!recorder) return;
    clearTimeout(recordingTimer);
    if (platform === "android") {
      const deadline = recordingStarted + 65_000;
      while (recorder.exitCode === null && recorder.signalCode === null && Date.now() < deadline)
        await delay(100);
      if (recorder.exitCode !== 0)
        throw new Error("Android screenrecord did not finish its owned 55-second recording.");
    } else await stop(recorder, "SIGINT");
    receipt.recordingSeconds = ((recorder.finishedAt ?? Date.now()) - recordingStarted) / 1000;
  })());
process.once("SIGTERM", () => {
  interrupted = true;
  controller.abort(new Error("Native CI runner interrupted."));
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        receipt.interruptionCleanupError = error.message;
      }
    }
  }
});
try {
  await save();
  await Promise.all([reserve(3100), reserve(8081)]);
  await mkdir(stateRoot, { recursive: true });
  if (dirname(stateDirectory) !== stateRoot || existsSync(stateDirectory))
    throw new Error("State ownership failed.");
  await mkdir(stateDirectory);
  stateOwned = true;
  await run("web-build", "pnpm", ["--filter", "@freshmarkets/web", "build"]);
  await run("migrations", process.execPath, [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "DB",
    "--config",
    "apps/core/wrangler.e2e.jsonc",
    "--local",
    "--persist-to",
    stateDirectory,
  ]);
  const backend = start("web-core", process.execPath, [
    wrangler,
    "dev",
    "-c",
    "apps/web/dist/server/wrangler.json",
    "-c",
    "apps/core/wrangler.e2e.jsonc",
    "--persist-to",
    stateDirectory,
    "--port",
    "3100",
    "--ip",
    "0.0.0.0",
  ]);
  receipt.backend = await waitFor(
    backend,
    "http://127.0.0.1:3100/api/core-health",
    async (response) => validateBackend(await response.json()),
  );
  if (platform === "ios") {
    receipt.xcode = {
      developerDirectory: command("xcode-select", ["-p"]),
      version: command("xcodebuild", ["-version"]),
    };
    const runtimes = JSON.parse(
      command("xcrun", ["simctl", "list", "runtimes", "--json"]),
    ).runtimes;
    const types = JSON.parse(
      command("xcrun", ["simctl", "list", "devicetypes", "--json"]),
    ).devicetypes;
    receipt.simulatorInventory = { runtimes, deviceTypes: types };
    const runtime = runtimes.find(
      (item) => item.isAvailable && item.version === "26.4.1" && item.identifier.includes("iOS"),
    );
    const type = types.find((item) => item.name === "iPhone 17 Pro");
    receipt.simulatorSelection = { runtime, deviceType: type };
    await save();
    if (!runtime) throw new Error("Pinned iOS 26.4.1 simulator runtime is unavailable.");
    if (!type) throw new Error("iPhone 17 Pro simulator type is unavailable.");
    simulator = command("xcrun", [
      "simctl",
      "create",
      `FreshMarkets-${stateName}`,
      type.identifier,
      runtime.identifier,
    ]);
    receipt.device = simulator;
    command("xcrun", ["simctl", "boot", simulator]);
    await run("simulator-boot", "xcrun", ["simctl", "bootstatus", simulator, "-b"]);
  } else {
    receipt.device = "emulator-5554";
    const mappings = command("adb", ["-s", receipt.device, "reverse", "--list"]);
    if (mappings.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[1] === "tcp:8081"))
      throw new Error("Metro reverse mapping is already owned.");
    command("adb", ["-s", receipt.device, "reverse", "tcp:8081", "tcp:8081"]);
    mapping = "tcp:8081";
  }
  const expoDevice =
    platform === "android"
      ? command("adb", ["-s", receipt.device, "emu", "avd", "name"])
          .split(/\r?\n/)
          .find((line) => line && line !== "OK")
      : receipt.device;
  if (!expoDevice) throw new Error("Cannot identify the owned device for Expo.");
  receipt.expoDevice = expoDevice;
  await run(
    "native-build",
    process.execPath,
    [expo, `run:${platform}`, "--device", expoDevice, "--no-bundler"],
    mobileRoot,
  );
  const metro = start(
    "metro",
    process.execPath,
    [
      "--dns-result-order=ipv4first",
      expo,
      "start",
      "--dev-client",
      "--scheme",
      "freshmarkets-development",
      "--localhost",
      "--port",
      "8081",
    ],
    mobileRoot,
  );
  const info = await waitFor(
    metro,
    `http://127.0.0.1:8081/_expo/open?platform=${platform}&runtime=custom`,
    (response) => response.json(),
  );
  receipt.expoOpen = info;
  await save();
  if (info.runtime !== "custom" || info.appId !== appId)
    throw new Error("Metro returned the wrong development application.");
  const link = new URL(info.url);
  if (link.protocol !== "freshmarkets-development:" || link.hostname !== "expo-development-client")
    throw new Error("Unexpected development-client deep link.");
  const projectUrl = new URL(link.searchParams.get("url"));
  if (
    projectUrl.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(projectUrl.hostname) ||
    projectUrl.port !== "8081"
  )
    throw new Error("Metro deep link is not owned loopback.");
  for (const key of ["disableOnboarding", "disableFab", "disableAutoLaunch"])
    link.searchParams.set(key, "1");
  receipt.launchUrl = link.toString();
  if (platform === "android")
    command("adb", [
      "-s",
      receipt.device,
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `'${link.toString().replaceAll("'", "'\\''")}'`,
      appId,
    ]);
  else command("xcrun", ["simctl", "openurl", receipt.device, link.toString()]);
  options = {
    platform,
    device: receipt.device,
    lane: "shell",
    "backend-origin": env.EXPO_PUBLIC_BACKEND_ORIGIN,
    "backend-host-origin": "http://127.0.0.1:3100",
  };
  receipt.prerequisites = await preflight(options);
  receipt.build = receipt.prerequisites.build;
  if (platform === "ios")
    await runFlow(
      options,
      { directory, manifest: {} },
      "open-development-client",
      controller.signal,
    );
  const args = [
    "--platform",
    platform,
    "--device",
    receipt.device,
    "--backend-origin",
    options["backend-origin"],
    "--backend-host-origin",
    options["backend-host-origin"],
  ];
  await run("ready", process.execPath, [
    join(mobileRoot, "scripts/verify-journey.mjs"),
    ...args,
    "--lane",
    "ready",
  ]);
  if (platform === "android")
    command("adb", ["-s", receipt.device, "shell", "am", "start", "-n", `${appId}/.MainActivity`]);
  else command("xcrun", ["simctl", "launch", receipt.device, appId]);
  recordingStarted = Date.now();
  const video = join(directory, "shell.mp4");
  recorder =
    platform === "android"
      ? start("video", "adb", [
          "-s",
          receipt.device,
          "shell",
          "screenrecord",
          "--time-limit",
          "55",
          deviceVideo,
        ])
      : start("video", "xcrun", [
          "simctl",
          "io",
          receipt.device,
          "recordVideo",
          "--codec=h264",
          video,
        ]);
  if (platform === "ios")
    recordingTimer = setTimeout(() => {
      stopRecording().catch((error) => {
        receipt.videoError = error.message;
      });
    }, 55_000);
  await run("shell-journey", process.execPath, [
    join(mobileRoot, "scripts/verify-journey.mjs"),
    ...args,
    "--lane",
    "shell",
  ]);
  await delay(Math.max(0, 32_000 - (Date.now() - recordingStarted)));
  await stopRecording();
  if (platform === "android") command("adb", ["-s", receipt.device, "pull", deviceVideo, video]);
  if (
    receipt.videoError ||
    receipt.recordingSeconds < 30 ||
    receipt.recordingSeconds > 65 ||
    (await stat(video)).size === 0
  )
    throw new Error("Native video capture failed.");
  receipt.servedBundles = (await readFile(env.FM_NATIVE_EVIDENCE, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (
    !receipt.servedBundles.some(
      (bundle) =>
        bundle.sourceSha === sha &&
        bundle.platform === platform &&
        bundle.status === 200 &&
        bundle.bytes > 0,
    )
  )
    throw new Error("The installed device did not fetch an observed successful bundle.");
  receipt.bundleIdentityLimit =
    "SHA-256 of actual Metro response bytes in the isolated device session. No claim of device memory attestation or release-build identity.";
  if (platform === "ios") {
    const timingDirectory = join(directory, "ios-clock-smoke");
    const transport = await prepareIosTiming({
      device: receipt.device,
      directory: timingDirectory,
      appId,
      backendOrigin: options["backend-origin"],
    });
    receipt.iosClockSmoke = await runIosColdTrial(transport, {
      directory: timingDirectory,
      callerSignal: controller.signal,
      assertReady: (signal) =>
        runFlow(options, { directory: timingDirectory, manifest: {} }, "ready", signal),
    });
    await writeFile(
      join(timingDirectory, "result.json"),
      `${JSON.stringify(receipt.iosClockSmoke, null, 2)}\n`,
    );
  } else
    await run("android-performance", process.execPath, [
      join(mobileRoot, "scripts/measure-journey.mjs"),
      ...args,
    ]);
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  if (interrupted) {
    receipt.status = "failed";
    receipt.error = "Native CI runner interrupted.";
    process.exitCode = 1;
  }
  const clean = async (name, action) => {
    try {
      await action();
      receipt.cleanup[name] = "completed";
      return true;
    } catch (error) {
      receipt.cleanup[name] = error.message;
      receipt.status = "failed";
      process.exitCode = 1;
      return false;
    }
  };
  await clean("video", stopRecording);
  if (platform === "android" && recordingStarted && !existsSync(join(directory, "shell.mp4")))
    await clean("failedVideoEvidence", () =>
      command("adb", ["-s", receipt.device, "pull", deviceVideo, join(directory, "shell.mp4")]),
    );
  let processesStopped = true;
  for (const child of children) {
    const stopped = await clean(`process-${child.pid}`, () => stop(child));
    processesStopped = stopped && processesStopped;
  }
  if (mapping)
    await clean("metroReverse", () =>
      command("adb", ["-s", receipt.device, "reverse", "--remove", mapping]),
    );
  if (platform === "android" && recordingStarted)
    await clean("deviceVideo", () =>
      command("adb", ["-s", receipt.device, "shell", "rm", deviceVideo]),
    );
  if (simulator)
    await clean("simulator", () => {
      command("xcrun", ["simctl", "shutdown", simulator]);
      command("xcrun", ["simctl", "delete", simulator]);
    });
  const portsFree = await clean("ports", () => Promise.all([reserve(3100), reserve(8081)]));
  if (stateOwned && processesStopped && portsFree)
    await clean("state", async () => {
      if (dirname(stateDirectory) !== stateRoot || !/^e2e-native-[a-f0-9-]+$/.test(stateName))
        throw new Error("Unsafe cleanup path.");
      await rm(stateDirectory, { recursive: true });
    });
  else if (stateOwned)
    receipt.cleanup.state = "Retained because owned process cleanup or port checks failed.";
  receipt.finishedAt = new Date().toISOString();
  await save();
  console.log(`Native ${platform} ${receipt.status}. Evidence ${directory}`);
}

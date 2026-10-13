import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = resolve(mobileRoot, "../..");
export const maestroVersion = "2.11.0";
export const appId = "ph.freshmarkets.customer.development";
const lanes = new Set(["shell", "ready", "retry", "network-off"]);

export function parseOptions(args) {
  const options = { lane: "shell" };
  const allowed = new Set(["platform", "device", "backend-origin", "backend-host-origin", "lane"]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!allowed.has(key) || !args[index].startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Use --platform android|ios --device ID --backend-origin ORIGIN --backend-host-origin ORIGIN [--lane shell|ready|retry|network-off].",
      );
    }
    if (Object.hasOwn(options, key) && key !== "lane") throw new Error(`Duplicate option ${key}.`);
    options[key] = value;
  }
  if (!["android", "ios"].includes(options.platform))
    throw new Error("Select --platform android or ios.");
  if (!options.device || !/^[a-zA-Z0-9:._-]+$/.test(options.device))
    throw new Error("Select an explicit device ID.");
  if (!lanes.has(options.lane)) throw new Error("Unknown native lane.");
  for (const key of ["backend-origin", "backend-host-origin"]) {
    const url = new URL(options[key]);
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`${key} must be an HTTP origin without credentials or a path.`);
    }
    const host = url.hostname;
    if (
      !/^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
        host,
      )
    ) {
      throw new Error(`${key} must address the isolated local backend.`);
    }
    options[key] = url.origin;
  }
  const deviceOrigin = new URL(options["backend-origin"]);
  const hostOrigin = new URL(options["backend-host-origin"]);
  const loopback = new Set(["localhost", "127.0.0.1"]);
  const deviceAliases = new Set([
    ...loopback,
    ...(options.platform === "android" ? ["10.0.2.2"] : []),
  ]);
  if (
    !loopback.has(hostOrigin.hostname) ||
    !deviceAliases.has(deviceOrigin.hostname) ||
    deviceOrigin.port !== hostOrigin.port
  )
    throw new Error(
      "Verification requires matching emulator and host loopback ports. LAN backend identity is unproved.",
    );
  return options;
}

export function commandAsync(executable, args, { timeout = 120_000, signal } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const invocation = commandInvocation(executable, args);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: repositoryRoot,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: platform() !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let failure;
    let stopping;
    const stopGroup = async () => {
      if (!child.pid) return;
      const send = (signal) => {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      if (!send("SIGTERM")) return;
      const forceAt = performance.now() + 5_000;
      const deadline = forceAt + 5_000;
      let forced = false;
      while (send(0)) {
        if (performance.now() >= deadline)
          throw new Error(`Owned process group ${child.pid} survived forced cleanup.`);
        if (!forced && performance.now() >= forceAt) {
          if (!send("SIGKILL")) return;
          forced = true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const stop = (error) => {
      if (stopping) return;
      failure = error;
      if (platform() === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        stopping = Promise.resolve();
      } else
        stopping = stopGroup().catch((cleanupError) => {
          failure = new AggregateError(
            [failure, cleanupError],
            `${executable} could not stop its owned process group. ${cleanupError.message}`,
          );
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          failure.commandOutput = `${stdout}\n${stderr}`;
          reject(failure);
        });
    };
    const abort = () => stop(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new Error(`${executable} timed out.`)), timeout);
    const append = (chunk, stream) => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 10 * 1024 * 1024)
        stop(new Error(`${executable} output exceeded 10 MiB.`));
    };
    child.stdout.on("data", (chunk) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(chunk, "stderr"));
    if (signal?.aborted) abort();
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      await stopping;
      if (failure || code !== 0) {
        const error =
          failure ?? new Error(`${executable} failed with exit ${code}. ${stderr.trim()}`);
        error.commandOutput = `${stdout}\n${stderr}`;
        reject(error);
      } else resolve(stdout.trim());
    });
  });
}

export function collectOutput(child) {
  let stdout = "";
  let stderr = "";
  let failure;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    failure = error;
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  return {
    text: () => stdout,
    async stop() {
      child.kill();
      const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await closed;
      clearTimeout(force);
      if (failure || stderr.trim()) throw failure ?? new Error(stderr.trim());
      return stdout;
    },
  };
}

export function trialTimingLog(log, { fence, pid }) {
  if (!/^\d+$/.test(pid)) throw new Error("A timing trial requires one fresh process ID.");
  const lines = log.split(/\r?\n/);
  const index = lines.findIndex(
    (line) => line.includes("FreshMarketsProbe") && line.endsWith(fence),
  );
  if (index < 0) throw new Error("The timing capture did not observe its live launch fence.");
  return lines
    .slice(index + 1)
    .filter(
      (line) =>
        line.includes("ActivityTaskManager") ||
        (line.includes("FM_PERF") && line.trim().split(/\s+/)[1] === pid),
    )
    .join("\n");
}

export function command(executable, args, timeout = 30_000) {
  const invocation = commandInvocation(executable, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(
      `${executable} ${args[0] ?? ""} failed. ${result.error?.message ?? result.stderr?.trim() ?? `Exit ${result.status}`}`,
    );
    error.commandOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    throw error;
  }
  return result.stdout.trim();
}

export function commandInvocation(executable, args) {
  if (platform() !== "win32" || executable !== "maestro") return { executable, args };
  if (args.some((arg) => /["%!&|<>^\r\n]/.test(arg)))
    throw new Error("Unsafe Windows command argument.");
  return {
    executable: "cmd.exe",
    args: ["/d", "/s", "/c", `${executable} ${args.map((arg) => `"${arg}"`).join(" ")}`],
    windowsVerbatimArguments: true,
  };
}

export function validateBackend(health) {
  if (
    health.service !== "core" ||
    health.status !== "ok" ||
    health.environment !== "development" ||
    health.databaseBindingConfigured !== true ||
    typeof health.contractVersion !== "string" ||
    health.contractVersion.length === 0
  ) {
    throw new Error("The backend must be real development Core with its D1 binding.");
  }
  return {
    environment: health.environment,
    databaseBindingConfigured: true,
    contractVersion: health.contractVersion,
    acceptance: "Core liveness only. Database execution and commerce readiness are not proved.",
  };
}

export async function preflight(options) {
  if (options.platform === "ios" && platform() !== "darwin")
    throw new Error("iOS requires a macOS host with Xcode and a booted simulator.");
  const maestro = command("maestro", ["--version"]);
  if (!new RegExp(`(^|\\s)${maestroVersion.replaceAll(".", "\\.")}(\\s|$)`).test(maestro)) {
    throw new Error(`Install pinned Maestro CLI ${maestroVersion}. Observed ${maestro}.`);
  }
  const java = spawnSync("java", ["-version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  const javaVersion = `${java.stdout ?? ""}\n${java.stderr ?? ""}`.match(/version "(\d+)/)?.[1];
  if (java.error || java.status !== 0 || !javaVersion || Number(javaVersion) < 17)
    throw new Error("Maestro requires Java 17 or later.");
  let build;
  let device;
  if (options.platform === "android") {
    const adb = (...args) => command("adb", ["-s", options.device, ...args]);
    if (adb("get-state") !== "device")
      throw new Error("The selected Android device is unavailable.");
    const paths = adb("shell", "pm", "path", appId).split(/\r?\n/).filter(Boolean);
    if (!paths.length || paths.some((path) => !path.startsWith("package:/")))
      throw new Error("Install the FreshMarkets development build on the selected device.");
    const hashes = paths.map((path) => adb("shell", "sha256sum", path.slice(8)).split(/\s/)[0]);
    if (hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
      throw new Error("Cannot establish installed Android build identity.");
    const packageInfo = adb("shell", "dumpsys", "package", appId)
      .split(/\r?\n/)
      .filter((line) => /versionCode=|versionName=|lastUpdateTime=/.test(line))
      .map((line) => line.trim());
    build = { appId, apkSha256: hashes, packageInfo };
    device = {
      id: options.device,
      model: adb("shell", "getprop", "ro.product.model"),
      os: adb("shell", "getprop", "ro.build.version.release"),
    };
  } else {
    const inventory = JSON.parse(
      command("xcrun", ["simctl", "list", "devices", "booted", "--json"]),
    );
    const selected = Object.values(inventory.devices)
      .flat()
      .find((item) => item.udid === options.device && item.state === "Booted" && item.isAvailable);
    if (!selected)
      throw new Error(
        "Select an available booted iOS simulator. Physical iOS driving is not proved by this runner.",
      );
    const container = command("xcrun", [
      "simctl",
      "get_app_container",
      options.device,
      appId,
      "app",
    ]);
    const executable = command("plutil", [
      "-extract",
      "CFBundleExecutable",
      "raw",
      "-o",
      "-",
      join(container, "Info.plist"),
    ]);
    if (!/^[\w.-]+$/.test(executable))
      throw new Error("Invalid installed iOS executable identity.");
    build = {
      appId,
      executableSha256: createHash("sha256")
        .update(readFileSync(join(container, executable)))
        .digest("hex"),
    };
    device = {
      id: selected.udid,
      model: selected.name,
      os: Object.keys(inventory.devices).find((runtime) =>
        inventory.devices[runtime].some((item) => item.udid === selected.udid),
      ),
    };
  }
  const fetchJson = async (origin, path) => {
    const response = await fetch(`${origin}${path}`, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Core ${path} returned ${response.status}.`);
    return response.json();
  };
  const backend = validateBackend(
    await fetchJson(options["backend-host-origin"], "/api/core-health"),
  );
  return {
    maestro,
    javaVersion,
    device,
    build,
    backend,
    identity: {
      installedBinary: "Observed SHA-256 of installed development binary only.",
      servedJavaScript:
        "Unverified. An installed development binary can load another checkout's Metro bundle.",
      backend:
        "Host Core liveness and documented emulator origin alias only. No device instance attestation.",
    },
  };
}

export function createEvidence(options, purpose) {
  const id = `${options.platform}-${purpose}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(repositoryRoot, ".wrangler", "swarm", "MOBILE-20261012.1.FOUNDATION", id);
  mkdirSync(directory, { recursive: true });
  const manifest = {
    taskId: "MOBILE-20261012.1.FOUNDATION",
    purpose,
    status: "running",
    hostCheckoutSha: command("git", ["rev-parse", "HEAD"]),
    servedJavaScriptSha: "unverified",
    workingTree: command("git", ["status", "--porcelain"]),
    host: hostname(),
    hostPlatform: platform(),
    startedAt: new Date().toISOString(),
    options,
    appId,
  };
  return { directory, manifest };
}

export function saveEvidence(evidence) {
  writeFileSync(
    join(evidence.directory, "manifest.json"),
    `${JSON.stringify(evidence.manifest, null, 2)}\n`,
  );
}

export async function runFlow(options, evidence, lane = options.lane, signal) {
  const backendPattern = options["backend-origin"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const args = [
    "--device",
    options.device,
    "--platform",
    options.platform,
    "test",
    "--format",
    "JUNIT",
    "--output",
    join(evidence.directory, `${lane}.xml`),
    "--debug-output",
    join(evidence.directory, `${lane}-debug`),
    "--test-output-dir",
    join(evidence.directory, "screenshots"),
    "-e",
    `APP_ID=${appId}`,
    "-e",
    `BACKEND_ORIGIN=${backendPattern}`,
    join(mobileRoot, "flows", `${lane}.yaml`),
  ];
  writeFileSync(
    join(evidence.directory, `${lane}-actions.json`),
    `${JSON.stringify({ executable: "maestro", args }, null, 2)}\n`,
  );
  try {
    const output = await commandAsync("maestro", args, { timeout: 120_000, signal });
    writeFileSync(join(evidence.directory, `${lane}.log`), `${output}\n`);
  } catch (error) {
    writeFileSync(
      join(evidence.directory, `${lane}.log`),
      `${error.commandOutput ?? error.message}\n`,
    );
    throw error;
  }
}

export function stopOwnedApp(options) {
  if (options.platform === "android")
    command("adb", ["-s", options.device, "shell", "am", "force-stop", appId]);
  else command("xcrun", ["simctl", "terminate", options.device, appId]);
}

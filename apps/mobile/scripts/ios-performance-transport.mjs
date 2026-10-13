import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandAsync } from "./native-driver.mjs";

const source = join(dirname(fileURLToPath(import.meta.url)), "ios-native-clock.c");
const predicate =
  '(subsystem == "com.facebook.react.log" AND category == "javascript" AND eventMessage CONTAINS "FM_PERF") OR subsystem == "ph.freshmarkets.native-clock"';

function ticks(value, name) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new Error(`Invalid or imprecise ${name}.`);
}

function clock(raw) {
  if (
    !Number.isSafeInteger(raw.pid) ||
    raw.pid <= 0 ||
    !Number.isSafeInteger(raw.numer) ||
    raw.numer <= 0 ||
    !Number.isSafeInteger(raw.denom) ||
    raw.denom <= 0
  )
    throw new Error("Invalid Mach clock identity or timebase.");
  const result = { ...raw };
  for (const key of ["absoluteBefore", "absoluteAfter", "continuousBefore", "continuousAfter"])
    result[key] = ticks(raw[key], key);
  if (
    result.absoluteAfter < result.absoluteBefore ||
    result.continuousAfter < result.continuousBefore
  )
    throw new Error("The clock bracket moves backwards.");
  result.offset = [
    result.continuousBefore - result.absoluteAfter,
    result.continuousAfter - result.absoluteBefore,
  ];
  return result;
}

export function parseIosLog(log) {
  return log
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => {
      const exact = line.replace(/("machTimestamp"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"');
      const record = JSON.parse(exact);
      if (typeof record.eventMessage !== "string")
        throw new Error("Unified log omitted its public message.");
      return { ...record, machTimestamp: ticks(record.machTimestamp, "unified log timestamp") };
    });
}

export function parseIosColdStart({
  log,
  calibrations,
  before,
  process: identity,
  afterProcess,
  expected,
}) {
  if (calibrations.length !== 2) throw new Error("Two clock calibrations are required.");
  const fence = clock(before);
  const birth = ticks(identity.birth, "kernel process birth");
  if (
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    identity.pid !== expected.pid ||
    identity.path !== expected.executablePath ||
    afterProcess.pid !== identity.pid ||
    afterProcess.path !== identity.path ||
    ticks(afterProcess.birth, "final process birth") !== birth
  )
    throw new Error("The native PID, executable path, or process birth changed.");
  if (birth < fence.absoluteAfter)
    throw new Error("The launch reused a process born before the launch fence.");
  const records = parseIosLog(log);
  const brackets = calibrations.map(clock);
  if (
    new Set(brackets.map((item) => item.token)).size !== 2 ||
    brackets.some((item) => typeof item.token !== "string" || !/^[a-z0-9-]{1,80}$/.test(item.token))
  )
    throw new Error("Clock calibration tokens must identify two different probes.");
  if (brackets[0].absoluteAfter > fence.absoluteBefore || brackets[1].absoluteBefore < birth)
    throw new Error("Clock probes do not bracket the fresh native launch.");
  for (const bracket of brackets) {
    if (bracket.numer !== fence.numer || bracket.denom !== fence.denom)
      throw new Error("The simulator and host Mach timebases differ.");
    const hostBefore = clock(bracket.hostBefore);
    const hostAfter = clock(bracket.hostAfter);
    if (
      hostBefore.numer !== bracket.numer ||
      hostBefore.denom !== bracket.denom ||
      hostAfter.numer !== bracket.numer ||
      hostAfter.denom !== bracket.denom ||
      bracket.absoluteBefore < hostBefore.absoluteAfter ||
      bracket.absoluteAfter > hostAfter.absoluteBefore
    )
      throw new Error("The simulator clock is outside the enclosing host clock bracket.");
  }
  const lowOffset = brackets.reduce(
    (value, item) => (item.offset[0] > value ? item.offset[0] : value),
    brackets[0].offset[0],
  );
  const highOffset = brackets.reduce(
    (value, item) => (item.offset[1] < value ? item.offset[1] : value),
    brackets[0].offset[1],
  );
  if (lowOffset > highOffset) throw new Error("The sleep offset changed during the trial.");
  let domains = ["absolute", "continuous"];
  for (const bracket of brackets) {
    const hits = records.filter(
      (record) =>
        record.eventMessage === `FM_IOS_CLOCK ${bracket.token}` &&
        record.processID === bracket.pid &&
        record.subsystem === "ph.freshmarkets.native-clock",
    );
    if (hits.length !== 1) throw new Error("A unique public clock calibration is missing.");
    const at = hits[0].machTimestamp;
    domains = domains.filter(
      (domain) => at >= bracket[`${domain}Before`] && at <= bracket[`${domain}After`],
    );
  }
  if (!domains.length) throw new Error("Unified-log timestamps have an unknown clock domain.");
  const marks = records.filter(
    (record) =>
      record.processID === identity.pid &&
      record.subsystem === "com.facebook.react.log" &&
      record.category === "javascript" &&
      record.eventMessage.includes("FM_PERF"),
  );
  const parsed = marks.map((record) => {
    const raw = record.eventMessage.match(/FM_PERF\s+(\{.*\})\s*$/)?.[1];
    if (!raw) throw new Error("The native readiness mark is missing or redacted.");
    const mark = JSON.parse(raw);
    if (
      mark.platform !== "ios" ||
      mark.buildVariant !== "development" ||
      mark.backendOrigin !== expected.backendOrigin ||
      typeof mark.launchId !== "string" ||
      !mark.launchId ||
      !Number.isFinite(mark.elapsedMs) ||
      mark.elapsedMs < 0
    )
      throw new Error("The readiness mark belongs to another build or backend.");
    if (record.processImagePath && record.processImagePath !== identity.path)
      throw new Error("The logged executable path differs from the installed process.");
    const intervals = domains.map((domain) =>
      domain === "absolute"
        ? [record.machTimestamp, record.machTimestamp]
        : [record.machTimestamp - highOffset, record.machTimestamp - lowOffset],
    );
    const lower = intervals.reduce(
      (value, item) => (item[0] < value ? item[0] : value),
      intervals[0][0],
    );
    const upper = intervals.reduce(
      (value, item) => (item[1] > value ? item[1] : value),
      intervals[0][1],
    );
    if (lower < birth || upper > brackets[1].absoluteAfter)
      throw new Error("A readiness mark is outside the fresh process trial.");
    const ms = (value, roundUp) => {
      const numerator = (value - birth) * BigInt(fence.numer);
      const divisor = BigInt(fence.denom);
      const ns = (numerator + (roundUp ? divisor - 1n : 0n)) / divisor;
      if (ns > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("The duration cannot be represented precisely.");
      return Number(ns) / 1_000_000;
    };
    return { ...mark, lowerMs: ms(lower, false), upperMs: ms(upper, true) };
  });
  const shell = parsed.filter((mark) => mark.mark === "shell-ready");
  const backend = parsed.filter((mark) => mark.mark === "backend-ready");
  if (shell.length !== 1 || backend.length !== 1 || shell[0].launchId !== backend[0].launchId)
    throw new Error("A trial needs one fresh rendered shell and successful backend mark.");
  return {
    launchId: shell[0].launchId,
    nativeShellMs: shell[0].upperMs,
    customerReadyMs: Math.max(shell[0].upperMs, backend[0].upperMs),
    nativeShellIntervalMs: [shell[0].lowerMs, shell[0].upperMs],
    customerReadyIntervalMs: [
      Math.max(shell[0].lowerMs, backend[0].lowerMs),
      Math.max(shell[0].upperMs, backend[0].upperMs),
    ],
    jsShellMs: shell[0].elapsedMs,
    jsBackendMs: backend[0].elapsedMs,
    clockDomains: domains,
    process: identity,
    timebase: { numer: fence.numer, denom: fence.denom },
    stableSleepOffsetTicks: [String(lowOffset), String(highOffset)],
  };
}

export async function prepareIosTiming({ device, directory, appId, backendOrigin }) {
  if (process.platform !== "darwin")
    throw new Error("The kernel clock transport requires macOS and an iOS simulator.");
  if (!/^[a-zA-Z0-9-]+$/.test(device) || !/^[a-zA-Z0-9.]+$/.test(appId))
    throw new Error("Invalid simulator or application identity.");
  mkdirSync(directory, { recursive: true });
  const hostHelper = join(directory, "ios-host-clock");
  const simulatorHelper = join(directory, "ios-simulator-clock");
  await commandAsync("xcrun", [
    "--sdk",
    "macosx",
    "clang",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-DFM_HOST=1",
    source,
    "-o",
    hostHelper,
  ]);
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : undefined;
  if (!arch) throw new Error("Unsupported simulator host architecture.");
  await commandAsync("xcrun", [
    "--sdk",
    "iphonesimulator",
    "clang",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-target",
    `${arch}-apple-ios16.4-simulator`,
    source,
    "-o",
    simulatorHelper,
  ]);
  const container = await commandAsync("xcrun", [
    "simctl",
    "get_app_container",
    device,
    appId,
    "app",
  ]);
  const executable = await commandAsync("plutil", [
    "-extract",
    "CFBundleExecutable",
    "raw",
    "-o",
    "-",
    join(container, "Info.plist"),
  ]);
  if (!/^[\w.-]+$/.test(executable)) throw new Error("Invalid installed executable name.");
  return {
    device,
    appId,
    backendOrigin,
    hostHelper,
    simulatorHelper,
    executablePath: realpathSync(join(container, executable)),
  };
}

export async function awaitIosCalibration({
  emit,
  observe,
  signal,
  timeoutMs = 15_000,
  observationMs = 500,
}) {
  const deadline = performance.now() + timeoutMs;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    while (performance.now() < deadline) {
      bounded.throwIfAborted();
      const candidate = await emit(bounded);
      if (
        !Number.isSafeInteger(candidate.pid) ||
        candidate.pid <= 0 ||
        typeof candidate.token !== "string" ||
        !/^[a-z0-9-]{1,80}$/.test(candidate.token)
      )
        throw new Error("The simulator returned an invalid calibration identity.");
      const remaining = deadline - performance.now();
      if (remaining > 0 && (await observe(candidate, bounded, Math.min(observationMs, remaining))))
        return candidate;
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (!bounded.aborted) throw error;
  }
  throw new Error("No public iOS clock calibration was observed before the startup deadline.");
}

async function capture(device) {
  const child = spawn(
    "xcrun",
    [
      "simctl",
      "spawn",
      device,
      "log",
      "stream",
      "--style",
      "ndjson",
      "--level",
      "info",
      "--predicate",
      predicate,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let text = "";
  let error;
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    text += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("error", (failure) => {
    error = failure;
  });
  let closed = false;
  const close = new Promise((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  return {
    text: () => text,
    async waitFor(candidate, signal, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (error || closed)
          throw error ?? new Error("Unified-log capture exited before calibration.");
        signal.throwIfAborted();
        const records = parseIosLog(text.slice(0, text.lastIndexOf("\n") + 1));
        const hits = records.filter(
          (record) =>
            record.eventMessage === `FM_IOS_CLOCK ${candidate.token}` &&
            record.processID === candidate.pid &&
            record.subsystem === "ph.freshmarkets.native-clock",
        );
        if (hits.length > 1)
          throw new Error("The calibration log contains duplicate probe events.");
        if (hits.length === 1) return true;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return false;
    },
    async stop() {
      if (!closed) child.kill("SIGINT");
      const force = setTimeout(() => child.kill("SIGKILL"), 3_000);
      let deadline;
      try {
        await Promise.race([
          close,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("Unified-log capture survived forced cleanup.")),
              8_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(force);
        clearTimeout(deadline);
      }
      if (error || /error:|failed|invalid/i.test(stderr))
        throw error ?? new Error("Unified-log capture reported an error.");
      return text;
    },
  };
}

export async function runIosColdTrial(
  transport,
  { directory, assertReady, timeoutMs = 120_000, callerSignal },
) {
  callerSignal?.throwIfAborted();
  mkdirSync(directory, { recursive: true });
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  const execute = (executable, args, commandSignal = signal) =>
    commandAsync(executable, args, { timeout: timeoutMs, signal: commandSignal });
  const host = async (...args) => JSON.parse(await execute(transport.hostHelper, args));
  const stream = await capture(transport.device);
  let identity;
  let owned = false;
  let log;
  let result;
  const failures = [];
  const proof = {
    expected: { executablePath: transport.executablePath, backendOrigin: transport.backendOrigin },
    calibrations: [],
  };
  try {
    const calibrate = async () => {
      const chosen = await awaitIosCalibration({
        signal,
        emit: async (probeSignal) => {
          const token = randomUUID();
          const hostBefore = JSON.parse(
            await execute(transport.hostHelper, ["snapshot"], probeSignal),
          );
          const bracket = JSON.parse(
            await execute(
              "xcrun",
              ["simctl", "spawn", transport.device, transport.simulatorHelper, "calibrate", token],
              probeSignal,
            ),
          );
          if (bracket.token !== token)
            throw new Error("The simulator returned another clock calibration token.");
          const hostAfter = JSON.parse(
            await execute(transport.hostHelper, ["snapshot"], probeSignal),
          );
          return { ...bracket, hostBefore, hostAfter };
        },
        observe: (candidate, probeSignal, waitMs) => stream.waitFor(candidate, probeSignal, waitMs),
      });
      proof.calibrations.push(chosen);
    };
    await calibrate();
    proof.before = await host("snapshot");
    const launch = await execute("xcrun", ["simctl", "launch", transport.device, transport.appId]);
    const match = launch.match(new RegExp(`^${transport.appId.replaceAll(".", "\\.")}: (\\d+)$`));
    if (!match || /already|running|error/i.test(launch))
      throw new Error("The simulator did not report one fresh application launch.");
    const pid = Number(match[1]);
    proof.expected.pid = pid;
    owned = true;
    identity = await host("process", String(pid));
    proof.process = identity;
    if (
      identity.path !== transport.executablePath ||
      identity.pid !== pid ||
      ticks(identity.birth, "process birth") < clock(proof.before).absoluteAfter
    )
      throw new Error(
        "The simulator reused an existing process or launched a different executable.",
      );
    await assertReady(signal);
    await calibrate();
    proof.afterProcess = await host("process", String(pid));
    log = await stream.stop();
    result = parseIosColdStart({ ...proof, log });
  } catch (error) {
    failures.push(error);
  }
  try {
    log ??= await stream.stop();
  } catch (error) {
    failures.push(error);
    log = stream.text();
  }
  try {
    writeFileSync(join(directory, "ios-clock-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
    writeFileSync(join(directory, "ios-timing.ndjson"), log);
  } catch (error) {
    failures.push(error);
  }
  if (owned) {
    try {
      const cleanupSignal = AbortSignal.timeout(15_000);
      const current = JSON.parse(
        await commandAsync(transport.hostHelper, ["process", String(proof.expected.pid)], {
          timeout: 15_000,
          signal: cleanupSignal,
        }),
      );
      if (
        current.pid !== proof.expected.pid ||
        current.path !== transport.executablePath ||
        ticks(current.birth, "cleanup process birth") < clock(proof.before).absoluteAfter ||
        (identity && (current.path !== identity.path || current.birth !== identity.birth))
      )
        throw new Error("Owned native process identity changed before cleanup.");
      await commandAsync("xcrun", ["simctl", "terminate", transport.device, transport.appId], {
        timeout: 15_000,
        signal: cleanupSignal,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Native timing trial or cleanup failed.");
  return result;
}

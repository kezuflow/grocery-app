import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appId,
  command,
  collectOutput,
  createEvidence,
  parseOptions,
  preflight,
  runFlow,
  saveEvidence,
  stopOwnedApp,
  trialTimingLog,
} from "./native-driver.mjs";
import { parseColdStart, summarizeTrials } from "./performance-probe.mjs";
import { prepareIosTiming, runIosColdTrial } from "./ios-performance-transport.mjs";

let evidence;
let options;
let appOwned = false;
let capture;
let trialDirectory;
const controller = new AbortController();
const onInterrupt = () => controller.abort(new Error("Native timing interrupted by SIGINT."));
const onTerminate = () => controller.abort(new Error("Native timing interrupted by SIGTERM."));
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
try {
  options = parseOptions(process.argv.slice(2));
  evidence = createEvidence(options, "perf");
  evidence.manifest.measurement =
    options.platform === "android"
      ? "Android device monotonic ActivityTaskManager launch to rendered shell and successful Core readiness marks. Maestro execution time is excluded."
      : "iOS simulator kernel process birth to native unified-log readiness marks. Observed clock calibration bounds are rounded outwards. Maestro execution time is excluded.";
  evidence.manifest.webBaseline =
    "Not measured by this native command. Thirty paired trunk/head Web trials remain a separate mandatory gate.";
  saveEvidence(evidence);
  evidence.manifest.prerequisites = await preflight(options);
  const trials = [];
  const warmups = [];
  const launchIds = new Set();
  evidence.manifest.attempts = [];
  if (options.platform === "ios") {
    const transport = await prepareIosTiming({
      device: options.device,
      directory: evidence.directory,
      appId,
      backendOrigin: options["backend-origin"],
    });
    for (let index = 0; index < 36; index++) {
      controller.signal.throwIfAborted();
      const phase = index === 0 ? "smoke" : index < 6 ? "warmup" : "measured";
      trialDirectory = join(evidence.directory, `${phase}-${String(index).padStart(2, "0")}`);
      const attempt = { index, phase, directory: trialDirectory, status: "running" };
      evidence.manifest.attempts.push(attempt);
      saveEvidence(evidence);
      try {
        const trial = await runIosColdTrial(transport, {
          directory: trialDirectory,
          callerSignal: controller.signal,
          assertReady: (signal) =>
            runFlow(options, { directory: trialDirectory, manifest: {} }, "ready", signal),
        });
        if (launchIds.has(trial.launchId))
          throw new Error("An iOS cold trial reused a previous process readiness mark.");
        launchIds.add(trial.launchId);
        if (index === 0) evidence.manifest.clockSmoke = trial;
        else (index < 6 ? warmups : trials).push(trial);
        attempt.status = "passed";
        writeFileSync(
          join(evidence.directory, "timings.json"),
          `${JSON.stringify({ clockSmoke: evidence.manifest.clockSmoke, warmups, trials }, null, 2)}\n`,
        );
        console.log(`iOS ${phase} trial ${index + 1}/36 observed.`);
      } catch (error) {
        attempt.status = "failed";
        attempt.error = error.message;
        throw error;
      } finally {
        saveEvidence(evidence);
      }
    }
  } else {
    for (let index = 0; index < 35; index++) {
      controller.signal.throwIfAborted();
      const trialEvidence = {
        directory: join(evidence.directory, `trial-${String(index + 1).padStart(2, "0")}`),
        manifest: {},
      };
      trialDirectory = trialEvidence.directory;
      evidence.manifest.attempts.push({
        index,
        phase: index < 5 ? "warmup" : "measured",
        directory: trialDirectory,
        status: "running",
      });
      mkdirSync(trialDirectory, { recursive: true });
      saveEvidence(evidence);
      appOwned = true;
      stopOwnedApp(options);
      const previous = command("adb", ["-s", options.device, "shell", "ps", "-A"]);
      if (previous.split(/\r?\n/).some((line) => line.trim().split(/\s+/).at(-1) === appId))
        throw new Error("The preceding application process did not stop.");
      const fence = randomUUID();
      capture = collectOutput(
        spawn(
          "adb",
          [
            "-s",
            options.device,
            "logcat",
            "-T",
            "1",
            "-v",
            "threadtime",
            "-v",
            "monotonic",
            "ActivityTaskManager:I",
            "ReactNativeJS:I",
            "FreshMarketsProbe:I",
            "*:S",
          ],
          { windowsHide: true },
        ),
      );
      command("adb", [
        "-s",
        options.device,
        "shell",
        "log",
        "-p",
        "i",
        "-t",
        "FreshMarketsProbe",
        fence,
      ]);
      const deadline = Date.now() + 10_000;
      while (
        !capture
          .text()
          .split(/\r?\n/)
          .some((line) => line.includes("FreshMarketsProbe") && line.endsWith(fence))
      ) {
        controller.signal.throwIfAborted();
        if (Date.now() > deadline)
          throw new Error("Native timing capture did not reach its live fence.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      controller.signal.throwIfAborted();
      const launch = command("adb", [
        "-s",
        options.device,
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${appId}/.MainActivity`,
      ]);
      writeFileSync(join(trialDirectory, "launch.log"), `${launch}\n`);
      if (/Error:|Warning: Activity not started/.test(launch))
        throw new Error("The cold-start activity did not launch a fresh development process.");
      const pid = command("adb", ["-s", options.device, "shell", "pidof", appId]);
      if (!/^\d+$/.test(pid))
        throw new Error("The cold trial did not establish one fresh application PID.");
      writeFileSync(join(trialDirectory, "process.json"), `${JSON.stringify({ fence, pid })}\n`);
      await runFlow(options, trialEvidence, "ready", controller.signal);
      const marksDeadline = Date.now() + 10_000;
      while (true) {
        controller.signal.throwIfAborted();
        const observed = trialTimingLog(capture.text(), { fence, pid });
        if (
          observed.includes('"mark":"shell-ready"') &&
          observed.includes('"mark":"backend-ready"')
        )
          break;
        if (Date.now() > marksDeadline)
          throw new Error("The fresh process did not emit both timing readiness marks.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const log = await capture.stop();
      capture = undefined;
      controller.signal.throwIfAborted();
      const relevant = trialTimingLog(log, { fence, pid })
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes("FM_PERF") ||
            (line.includes("ActivityTaskManager") && line.includes(`cmp=${appId}/`)),
        )
        .join("\n");
      writeFileSync(join(trialEvidence.directory, "timing.log"), `${relevant}\n`);
      const trial = parseColdStart(relevant, { appId, backendOrigin: options["backend-origin"] });
      if (launchIds.has(trial.launchId))
        throw new Error("A cold trial reused a previous process readiness mark.");
      launchIds.add(trial.launchId);
      (index < 5 ? warmups : trials).push(trial);
      evidence.manifest.attempts.at(-1).status = "passed";
      writeFileSync(
        join(evidence.directory, "timings.json"),
        `${JSON.stringify({ warmups, trials }, null, 2)}\n`,
      );
      saveEvidence(evidence);
      console.log(`Native cold trial ${index + 1}/35 observed.`);
    }
  }
  evidence.manifest.summary = summarizeTrials(trials);
  evidence.manifest.status = `passed-native-${options.platform}-only`;
} catch (error) {
  if (evidence) {
    evidence.manifest.status = "failed";
    evidence.manifest.error = error.message;
    const attempt = evidence.manifest.attempts?.at(-1);
    if (attempt?.status === "running") {
      attempt.status = "failed";
      attempt.error = error.message;
    }
  }
  console.error(`Native performance gate failed. ${error.message}`);
  process.exitCode = 1;
} finally {
  if (capture) {
    try {
      const failedLog = await capture.stop();
      if (trialDirectory) writeFileSync(join(trialDirectory, "failed-timing.log"), failedLog);
    } catch (error) {
      evidence.manifest.captureCleanup = error.message;
      evidence.manifest.status = "failed";
      process.exitCode = 1;
    }
  }
  if (appOwned) {
    try {
      stopOwnedApp(options);
      evidence.manifest.cleanup =
        "Owned development app stopped. Device logs and business data preserved.";
    } catch (error) {
      evidence.manifest.cleanup = error.message;
      evidence.manifest.status = "failed";
      process.exitCode = 1;
    }
  }
  if (evidence) {
    evidence.manifest.counts = {
      plannedWarmups: 5,
      plannedMeasuredTrials: 30,
      attemptedTrials: evidence.manifest.attempts?.length ?? 0,
      passedTrials:
        evidence.manifest.attempts?.filter((item) => item.status === "passed").length ?? 0,
      failedTrials:
        evidence.manifest.attempts?.filter((item) => item.status === "failed").length ?? 0,
    };
    evidence.manifest.finishedAt = new Date().toISOString();
    saveEvidence(evidence);
    console.log(`Evidence ${evidence.directory}`);
  }
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}

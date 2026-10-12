import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appId,
  command,
  createEvidence,
  parseOptions,
  preflight,
  runFlow,
  saveEvidence,
  stopOwnedApp,
} from "./native-driver.mjs";
import { parseColdStart, summarizeTrials } from "./performance-probe.mjs";

let evidence;
let options;
let appOwned = false;
let capture;
try {
  options = parseOptions(process.argv.slice(2));
  evidence = createEvidence(options, "perf");
  evidence.manifest.measurement =
    "Android device monotonic ActivityTaskManager launch to rendered shell and successful Core readiness marks. Maestro execution time is excluded.";
  evidence.manifest.webBaseline =
    "Not measured by this native command. Thirty paired trunk/head Web trials remain a separate mandatory gate.";
  saveEvidence(evidence);
  evidence.manifest.prerequisites = await preflight(options);
  if (options.platform !== "android")
    throw new Error(
      "iOS cold-start timing transport is unavailable. No iOS performance acceptance can pass.",
    );
  const trials = [];
  const warmups = [];
  const launchIds = new Set();
  for (let index = 0; index < 35; index++) {
    appOwned = true;
    stopOwnedApp(options);
    let log = "";
    let captureError;
    capture = spawn(
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
        "*:S",
      ],
      { windowsHide: true },
    );
    capture.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    capture.stderr.on("data", (chunk) => {
      captureError = chunk.toString();
    });
    capture.on("error", (error) => {
      captureError = error.message;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
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
    if (/Error:|Warning: Activity not started/.test(launch))
      throw new Error("The cold-start activity did not launch a fresh development process.");
    const trialEvidence = {
      directory: join(evidence.directory, `trial-${String(index + 1).padStart(2, "0")}`),
      manifest: {},
    };
    mkdirSync(trialEvidence.directory, { recursive: true });
    runFlow(options, trialEvidence, "ready", false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    capture.kill();
    capture = undefined;
    if (captureError) throw new Error(`Native timing capture failed. ${captureError}`);
    const relevant = log
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.includes("FM_PERF") ||
          (line.includes("ActivityTaskManager") && line.includes(`cmp=${appId}/`)),
      )
      .join("\n");
    writeFileSync(join(trialEvidence.directory, "timing.log"), `${relevant}\n`);
    writeFileSync(join(trialEvidence.directory, "launch.log"), `${launch}\n`);
    const trial = parseColdStart(relevant, { appId, backendOrigin: options["backend-origin"] });
    if (launchIds.has(trial.launchId))
      throw new Error("A cold trial reused a previous process readiness mark.");
    launchIds.add(trial.launchId);
    (index < 5 ? warmups : trials).push(trial);
    writeFileSync(
      join(evidence.directory, "timings.json"),
      `${JSON.stringify({ warmups, trials }, null, 2)}\n`,
    );
    console.log(`Native cold trial ${index + 1}/35 observed.`);
  }
  evidence.manifest.summary = summarizeTrials(trials);
  evidence.manifest.status = "passed-native-android-only";
} catch (error) {
  if (evidence) {
    evidence.manifest.status = "failed";
    evidence.manifest.error = error.message;
  }
  console.error(`Native performance gate failed. ${error.message}`);
  process.exitCode = 1;
} finally {
  capture?.kill();
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
    evidence.manifest.finishedAt = new Date().toISOString();
    saveEvidence(evidence);
    console.log(`Evidence ${evidence.directory}`);
  }
}

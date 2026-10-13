import {
  command,
  createEvidence,
  parseOptions,
  preflight,
  runFlow,
  saveEvidence,
  stopOwnedApp,
} from "./native-driver.mjs";

let evidence;
let options;
let session = { phase: "validating" };
let tunnel;
const controller = new AbortController();
const interrupt = (signal) =>
  controller.abort(new Error(`Native journey interrupted by ${signal}.`));
const onInterrupt = () => interrupt("SIGINT");
const onTerminate = () => interrupt("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
try {
  options = parseOptions(process.argv.slice(2));
  evidence = createEvidence(options, "journey");
  saveEvidence(evidence);
  evidence.manifest.prerequisites = await preflight(options);
  if (options.lane === "retry") {
    const deviceOrigin = new URL(options["backend-origin"]);
    const hostOrigin = new URL(options["backend-host-origin"]);
    if (
      options.platform !== "android" ||
      deviceOrigin.hostname !== "127.0.0.1" ||
      !["127.0.0.1", "localhost"].includes(hostOrigin.hostname) ||
      deviceOrigin.port !== hostOrigin.port
    ) {
      throw new Error(
        "Retry driving requires Android with matching explicit device and host loopback ports.",
      );
    }
    const port = deviceOrigin.port || "80";
    const mappings = command("adb", ["-s", options.device, "reverse", "--list"]);
    if (mappings.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[1] === `tcp:${port}`))
      throw new Error(
        "The retry lane requires an unowned device port. Preserve existing ADB reverse mappings.",
      );
    controller.signal.throwIfAborted();
    session = { phase: "driving", ownsApp: true };
    await runFlow(options, evidence, "network-off", controller.signal);
    controller.signal.throwIfAborted();
    command("adb", ["-s", options.device, "reverse", "--no-rebind", `tcp:${port}`, `tcp:${port}`]);
    tunnel = `tcp:${port}`;
    evidence.manifest.mapping = { device: tunnel, host: tunnel, owner: "this run" };
    await runFlow(options, evidence, "retry", controller.signal);
  } else {
    controller.signal.throwIfAborted();
    session = { phase: "driving", ownsApp: options.lane !== "ready" };
    if (options.lane === "ready")
      evidence.manifest.observation =
        "Assertions on an already running application. This command did not launch or own it.";
    await runFlow(options, evidence, options.lane, controller.signal);
  }
  controller.signal.throwIfAborted();
  evidence.manifest.status = options.lane === "ready" ? "passed-observation" : "passed";
} catch (error) {
  if (evidence) {
    evidence.manifest.status = "failed";
    evidence.manifest.error = error.message;
  }
  console.error(`Native journey failed. ${error.message}`);
  process.exitCode = 1;
} finally {
  if (tunnel) {
    try {
      command("adb", ["-s", options.device, "reverse", "--remove", tunnel]);
      evidence.manifest.mappingCleanup = "Removed only this run's ADB reverse mapping.";
    } catch (error) {
      evidence.manifest.mappingCleanup = error.message;
      evidence.manifest.status = "failed";
      process.exitCode = 1;
    }
  }
  if (session.phase === "driving" && session.ownsApp) {
    try {
      stopOwnedApp(options);
      evidence.manifest.cleanup =
        "Owned development app stopped. Device and business data preserved.";
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
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}

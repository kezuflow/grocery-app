import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awaitIosCalibration,
  parseIosColdStart,
  parseIosLog,
  runIosColdTrial,
} from "./ios-performance-transport.mjs";

const base = 9007199254740993000n;
const offset = 100000000n;
const path = "/Applications/FreshMarkets.app/FreshMarkets";
const backendOrigin = "http://127.0.0.1:3100";
const snapshot = (at, delta = offset) => ({
  pid: 80,
  numer: 1,
  denom: 1,
  absoluteBefore: String(at),
  absoluteAfter: String(at + 100n),
  continuousBefore: String(at + delta + 50n),
  continuousAfter: String(at + delta + 60n),
});
function fixture(domain = "continuous") {
  const birth = base + 1000n;
  const calibrations = [base, birth + 300000000n].map((at, index) => ({
    ...snapshot(at),
    token: `probe-${index}`,
    pid: 100 + index,
    hostBefore: snapshot(at - 200n),
    hostAfter: snapshot(at + 200n),
  }));
  const timestamp = (at) => String(at + (domain === "continuous" ? offset : 0n));
  const records = calibrations.map((item, index) => ({
    processID: item.pid,
    subsystem: "ph.freshmarkets.native-clock",
    category: "calibration",
    eventMessage: `FM_IOS_CLOCK probe-${index}`,
    machTimestamp: timestamp(BigInt(item.absoluteBefore) + 55n),
  }));
  for (const [mark, elapsedMs, delta] of [
    ["shell-ready", 80, 100000000n],
    ["backend-ready", 180, 200000000n],
  ]) {
    records.push({
      processID: 123,
      processImagePath: path,
      subsystem: "com.facebook.react.log",
      category: "javascript",
      eventMessage: `FM_PERF ${JSON.stringify({ mark, elapsedMs, platform: "ios", buildVariant: "development", backendOrigin, launchId: "fresh-launch" })}`,
      machTimestamp: timestamp(birth + delta),
    });
  }
  const log = records
    .map((record) =>
      JSON.stringify(record).replace(/"machTimestamp":"(\d+)"/, '"machTimestamp":$1'),
    )
    .join("\n");
  const identity = { pid: 123, birth: String(birth), path };
  return {
    log,
    calibrations,
    before: snapshot(base + 200n),
    process: identity,
    afterProcess: { ...identity },
    expected: { pid: 123, executablePath: path, backendOrigin },
  };
}

test("native clock parser preserves exact unified timestamps beyond JavaScript integer precision", () => {
  assert.equal(
    parseIosLog('{"eventMessage":"probe","machTimestamp":9007199254740993007}')[0].machTimestamp,
    9007199254740993007n,
  );
  assert.throws(() => parseIosLog('{"eventMessage":"probe","machTimestamp":1.5}'), /imprecise/);
});

test("cold trial measures kernel birth to native marks with bounded continuous clock calibration", () => {
  const trial = parseIosColdStart(fixture());
  assert.deepEqual(trial.nativeShellIntervalMs, [99.99994, 100.00005]);
  assert.deepEqual(trial.customerReadyIntervalMs, [199.99994, 200.00005]);
  assert.equal(trial.nativeShellMs, 100.00005);
  assert.equal(trial.customerReadyMs, 200.00005);
  assert.deepEqual(trial.clockDomains, ["continuous"]);
  assert.equal(trial.jsShellMs, 80);
  assert.equal(trial.launchId, "fresh-launch");
});

test("an observed absolute log clock needs no sleep-offset subtraction", () => {
  const trial = parseIosColdStart(fixture("absolute"));
  assert.deepEqual(trial.nativeShellIntervalMs, [100, 100]);
  assert.deepEqual(trial.clockDomains, ["absolute"]);
});

test("clock calibration rejects unknown domains, missing markers, and sleep during a trial", () => {
  const unknown = fixture();
  unknown.log = unknown.log.replace(String(base + offset + 55n), String(base + offset + 10000n));
  assert.throws(() => parseIosColdStart(unknown), /unknown clock domain/);
  const missing = fixture();
  missing.log = missing.log.replace("FM_IOS_CLOCK probe-1", "FM_IOS_CLOCK other");
  assert.throws(() => parseIosColdStart(missing), /calibration is missing/);
  const asleep = fixture();
  asleep.calibrations[1].continuousBefore = String(
    BigInt(asleep.calibrations[1].continuousBefore) + 1000000000n,
  );
  asleep.calibrations[1].continuousAfter = String(
    BigInt(asleep.calibrations[1].continuousAfter) + 1000000000n,
  );
  assert.throws(() => parseIosColdStart(asleep), /sleep offset changed/);
});

test("launch proof rejects reused PIDs, wrong installed paths, and a replaced process", () => {
  const stale = fixture();
  stale.process.birth = String(base);
  stale.afterProcess.birth = String(base);
  assert.throws(() => parseIosColdStart(stale), /before the launch fence/);
  const wrong = fixture();
  wrong.process.path = "/Applications/Other.app/Other";
  assert.throws(() => parseIosColdStart(wrong), /executable path/);
  const replacement = fixture();
  replacement.afterProcess.birth = String(base + 2000n);
  assert.throws(() => parseIosColdStart(replacement), /process birth changed/);
});

test("readiness proof rejects another backend, stale marks, missing marks, and redaction", () => {
  const other = fixture();
  other.log = other.log.replaceAll("127.0.0.1", "192.168.0.2");
  assert.throws(() => parseIosColdStart(other), /another build or backend/);
  const stale = fixture();
  stale.log = stale.log.replace(
    String(base + 1000n + 100000000n + offset),
    String(base + 900n + offset),
  );
  assert.throws(() => parseIosColdStart(stale), /outside the fresh process trial/);
  const missing = fixture();
  missing.log = missing.log
    .split("\n")
    .filter((line) => !line.includes("backend-ready"))
    .join("\n");
  assert.throws(() => parseIosColdStart(missing), /one fresh rendered shell/);
  const redacted = fixture();
  redacted.log = redacted.log
    .split("\n")
    .map((line) => {
      if (!line.includes("shell-ready")) return line;
      const record = JSON.parse(line.replace(/("machTimestamp":)(\d+)/, '$1"$2"'));
      record.eventMessage = "FM_PERF <private>";
      return JSON.stringify(record);
    })
    .join("\n");
  assert.throws(() => parseIosColdStart(redacted), /redacted/);
});

test("simulator clock and host clock must share an observed absolute bracket", () => {
  const different = fixture();
  different.calibrations[0].hostAfter = snapshot(base - 500n);
  assert.throws(() => parseIosColdStart(different), /enclosing host clock/);
});

test("fractional timebase conversions round the interval outwards", () => {
  const input = fixture("absolute");
  for (const sample of [
    input.before,
    ...input.calibrations.flatMap((item) => [item, item.hostBefore, item.hostAfter]),
  ]) {
    sample.numer = 1;
    sample.denom = 3;
  }
  const trial = parseIosColdStart(input);
  assert.deepEqual(trial.nativeShellIntervalMs, [33.333333, 33.333334]);
  assert.equal(trial.nativeShellMs, 33.333334);
});

test("two calibration events cannot reuse one probe identity", () => {
  const input = fixture();
  input.calibrations[1].token = input.calibrations[0].token;
  assert.throws(() => parseIosColdStart(input), /two different probes/);
});

test("calibration startup selects the bracket whose fresh probe is actually observed", async () => {
  const signal = new AbortController().signal;
  let attempt = 0;
  let log = "";
  const chosen = await awaitIosCalibration({
    signal,
    timeoutMs: 1_000,
    observationMs: 100,
    emit: async () => {
      attempt += 1;
      const candidate = {
        ...snapshot(base + BigInt(attempt * 1000)),
        pid: 100 + attempt,
        token: `probe-${attempt}`,
        hostBefore: snapshot(base + BigInt(attempt * 1000 - 200)),
        hostAfter: snapshot(base + BigInt(attempt * 1000 + 200)),
      };
      if (attempt === 2)
        setTimeout(() => {
          log += `${JSON.stringify({
            processID: 102,
            subsystem: "ph.freshmarkets.native-clock",
            eventMessage: "FM_IOS_CLOCK probe-2",
            machTimestamp: String(base + offset + 2055n),
          })}\n`;
        }, 5);
      return candidate;
    },
    observe: async (candidate, bounded, timeoutMs) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        bounded.throwIfAborted();
        if (
          parseIosLog(log).some(
            (record) =>
              record.processID === candidate.pid &&
              record.subsystem === "ph.freshmarkets.native-clock" &&
              record.eventMessage === `FM_IOS_CLOCK ${candidate.token}`,
          )
        )
          return true;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      return false;
    },
  });
  assert.deepEqual(chosen, {
    pid: 102,
    numer: 1,
    denom: 1,
    absoluteBefore: "9007199254740995000",
    absoluteAfter: "9007199254740995100",
    continuousBefore: "9007199254840995050",
    continuousAfter: "9007199254840995060",
    token: "probe-2",
    hostBefore: snapshot(base + 1800n),
    hostAfter: snapshot(base + 2200n),
  });
});

test("calibration with no observed public token fails within its startup deadline", async () => {
  let attempt = 0;
  await assert.rejects(
    awaitIosCalibration({
      signal: new AbortController().signal,
      timeoutMs: 25,
      observationMs: 5,
      emit: async () => ({ pid: 100, token: `missing-${++attempt}` }),
      observe: async (_, signal, timeoutMs) => {
        signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        return false;
      },
    }),
    /No public iOS clock calibration was observed before the startup deadline/,
  );
});

test("calibration preserves caller cancellation and helper failures", async () => {
  const controller = new AbortController();
  const reason = new Error("The native trial was cancelled.");
  controller.abort(reason);
  await assert.rejects(
    awaitIosCalibration({
      signal: controller.signal,
      emit: async () => ({ pid: 100, token: "unused" }),
      observe: async () => true,
    }),
    (error) => error === reason,
  );
  await assert.rejects(
    awaitIosCalibration({
      signal: new AbortController().signal,
      emit: async () => {
        throw new Error("Cannot execute the simulator clock helper.");
      },
      observe: async () => true,
    }),
    /Cannot execute the simulator clock helper/,
  );
});

test("a cancelled cold trial stops before creating evidence or launching simulator tools", async () => {
  const controller = new AbortController();
  const reason = new Error("The caller cancelled native timing.");
  controller.abort(reason);
  await assert.rejects(
    runIosColdTrial(undefined, {
      directory: undefined,
      assertReady: undefined,
      callerSignal: controller.signal,
    }),
    (error) => error === reason,
  );
});

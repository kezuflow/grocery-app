import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidLastAnr } from "./android-health.mjs";

test("accepts only the Android no-ANR-since-boot diagnostic as clean", () => {
  assert.deepEqual(
    parseAndroidLastAnr(
      "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\r\n  <no ANR has occurred since boot>\r\n",
    ),
    { status: "clean" },
  );
});

test("retains a reasonless Android ANR rather than reporting a clean runner", () => {
  assert.deepEqual(
    parseAndroidLastAnr(
      "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  ANR time: Oct 13, 2026, 7:56:20 AM\n\n  ACTIVITY MANAGER ACTIVITIES\n",
    ),
    { status: "anr", time: "Oct 13, 2026, 7:56:20 AM" },
  );
  assert.deepEqual(
    parseAndroidLastAnr(
      "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  ANR time: Oct 13, 2026, 7:56:20 AM\n  Reason: Input dispatching timed out\n\n  ACTIVITY MANAGER ACTIVITIES\n",
    ),
    { status: "anr", time: "Oct 13, 2026, 7:56:20 AM", reason: "Input dispatching timed out" },
  );
});

test("refuses unknown, malformed, contradictory, and permission-denied ANR diagnostics", () => {
  for (const output of [
    "",
    "unknown command lastanr",
    "Permission Denial: can't dump ActivityManager",
    "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\nPermission Denial: can't dump ActivityManager",
    "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  ANR time:",
    "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  Reason: Input dispatching timed out",
    "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  <no ANR has occurred since boot>\n  ANR time: Oct 13, 2026, 7:56:20 AM",
    "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  ANR time: Oct 13, 2026, 7:56:20 AM\n  <no ANR has occurred since boot>",
  ])
    assert.deepEqual(parseAndroidLastAnr(output), { status: "unrecognized" });
});

export function parseAndroidLastAnr(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = "ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)";
  const noAnr = "<no ANR has occurred since boot>";
  if (lines[0] !== header || lines.some((line) => line.startsWith("Permission Denial:")))
    return { status: "unrecognized" };
  if (lines.length === 2 && lines[1] === noAnr) return { status: "clean" };
  const time = lines[1]?.match(/^ANR time: (.+)$/)?.[1];
  if (!time || lines.includes(noAnr)) return { status: "unrecognized" };
  const reason = lines[2]?.match(/^Reason: ?(.*)$/)?.[1];
  return { status: "anr", time, ...(reason !== undefined ? { reason } : {}) };
}

export function parseColdStart(log, expected) {
  const marks = [];
  let start;
  for (const line of log.split(/\r?\n/)) {
    const timestamp = line.match(/^\s*(\d+\.\d+)\s/);
    if (!timestamp) continue;
    const at = Number(timestamp[1]) * 1000;
    if (
      line.includes("ActivityTaskManager") &&
      line.includes("START u") &&
      line.includes(`cmp=${expected.appId}/`)
    ) {
      if (start !== undefined) throw new Error("The trial contains multiple native launches.");
      start = at;
    }
    const raw = line.match(/FM_PERF\s+(\{.*\})\s*$/)?.[1];
    if (!raw || start === undefined) continue;
    const mark = JSON.parse(raw);
    if (
      mark.platform !== "android" ||
      mark.buildVariant !== "development" ||
      mark.backendOrigin !== expected.backendOrigin ||
      typeof mark.launchId !== "string" ||
      !mark.launchId
    ) {
      throw new Error(
        "The readiness mark does not belong to the expected development build and backend.",
      );
    }
    marks.push({ ...mark, at });
  }
  const shell = marks.filter((mark) => mark.mark === "shell-ready");
  const backend = marks.filter((mark) => mark.mark === "backend-ready");
  if (start === undefined || shell.length !== 1 || backend.length !== 1)
    throw new Error(
      "The trial needs one native launch, rendered shell mark, and successful Core mark.",
    );
  if (shell[0].launchId !== backend[0].launchId || shell[0].at < start || backend[0].at < start)
    throw new Error("Readiness marks belong to a stale process.");
  if (
    !Number.isFinite(shell[0].elapsedMs) ||
    shell[0].elapsedMs < 0 ||
    !Number.isFinite(backend[0].elapsedMs) ||
    backend[0].elapsedMs < 0
  )
    throw new Error("Readiness marks need monotonic nonnegative elapsed milliseconds.");
  return {
    launchId: shell[0].launchId,
    nativeShellMs: shell[0].at - start,
    customerReadyMs: Math.max(shell[0].at, backend[0].at) - start,
    jsShellMs: shell[0].elapsedMs,
    jsBackendMs: backend[0].elapsedMs,
  };
}

export function summarizeTrials(trials) {
  if (trials.length !== 30)
    throw new Error(
      "Native acceptance requires exactly thirty measured trials after five warmups.",
    );
  if (new Set(trials.map((trial) => trial.launchId)).size !== 30)
    throw new Error("Every cold trial must launch a fresh process.");
  const p95 = (key) => {
    const values = trials.map((trial) => trial[key]);
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      throw new Error("A trial has an invalid elapsed time.");
    return values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  };
  const summary = {
    trials: trials.length,
    nativeShellP95Ms: p95("nativeShellMs"),
    customerReadyP95Ms: p95("customerReadyMs"),
    jsShellP95Ms: p95("jsShellMs"),
    jsBackendP95Ms: p95("jsBackendMs"),
  };
  if (summary.nativeShellP95Ms > 1000 || summary.customerReadyP95Ms > 5000)
    throw new Error(`Native budgets exceeded. ${JSON.stringify(summary)}`);
  return summary;
}

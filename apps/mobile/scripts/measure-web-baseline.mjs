import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const trialOrder = () =>
  ["warmup", "measured"].flatMap((phase) =>
    Array.from({ length: phase === "warmup" ? 5 : 30 }, (_, pair) =>
      ["baseline", "head"].map((side) => ({ phase, pair: pair + 1, side })),
    ).flat(),
  );

export function summarize(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Timing samples must be nonempty, finite, and nonnegative.");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    minimumMs: sorted[0],
    maximumMs: sorted.at(-1),
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p95Method: "nearest-rank",
  };
}

export function regressionGate(baseline, head) {
  const differenceMs = head.p95Ms - baseline.p95Ms;
  const relativeIncrease = baseline.p95Ms === 0 ? null : differenceMs / baseline.p95Ms;
  return {
    differenceMs,
    relativeIncrease,
    regression: differenceMs > 100 && head.p95Ms > baseline.p95Ms * 1.15,
    rule: "Fail only when Web p95 increases by both more than 15 percent and more than 100 milliseconds.",
  };
}

async function main() {
  if (process.platform !== "linux" || process.env.CI !== "true")
    throw new Error("Use an isolated Linux CI runner for paired Web measurements.");
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--baseline" || args[2] !== "--head")
    throw new Error("Use --baseline PATH --head PATH for two frozen checkouts.");
  const roots = {
    baseline: await realpath(resolve(args[1])),
    head: await realpath(resolve(args[3])),
  };
  if (roots.baseline === roots.head) throw new Error("The two checkouts must be separate.");
  const baselineSha = "9b1b59cc8fb0ebe1e6374bc760cee8c82237410f";
  const relevant = [
    "apps/web",
    "apps/core",
    "packages",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ];
  const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const directory = join(
    roots.head,
    ".wrangler/swarm/MOBILE-20261012.1.FOUNDATION",
    `web-perf-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const receipt = {
    status: "running",
    startedAt: new Date().toISOString(),
    claim:
      "The paired selected-location Web journey does not breach Foundation's p95 regression rule on this fixed CI runner.",
    metric:
      "Navigation start through observed rendered categories and current price, including welcome automation and assertion overhead and two animation frames. Browser launch is excluded.",
    scenario: {
      latitude: 10.32,
      longitude: 123.9,
      category: "Fruits",
      product: "Baguio Strawberries",
      price: "₱179.00",
      priceLabel: "₱179.00 / 500 g",
    },
    nativeBaseline: "Unavailable at trunk. No Web/native ratio is computed.",
    limits:
      "Production Web builds on isolated local Worker/D1 test configuration and synthetic development catalog. No actual provider latency or production throughput claim. Fresh browser processes; warmed server stacks.",
    host: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cores: os.cpus().length,
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
      loadAverage: os.loadavg(),
    },
    sides: {},
    trials: [],
    profiles: [],
    cleanup: {},
  };
  const children = [];
  let activeBrowser;
  let interrupted = false;
  const save = () =>
    writeFile(join(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  const inside = (root, path) => {
    const suffix = relative(root, path);
    return suffix !== "" && !suffix.startsWith("..") && !isAbsolute(suffix);
  };
  const freePort = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new Error(`Port ${port} is occupied; refusing reuse.`)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  const counters = () =>
    execFileSync("ps", ["-eo", "pid,ppid,pgid,comm,pcpu,time"], { encoding: "utf8" });
  const start = (side, name, executable, args) => {
    const log = createWriteStream(join(directory, `${side.name}-${name}.log`));
    const child = spawn(executable, args, {
      cwd: side.root,
      env: side.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("close", () => log.end());
    child.on("error", (error) => {
      child.failure = error.message;
    });
    children.push(child);
    side.processes.push({ name, pid: child.pid });
    return child;
  };
  const run = async (side, name, executable, args) => {
    const child = start(side, name, executable, args);
    const code = await new Promise((resolve) => {
      child.once("error", () => resolve(-1));
      child.once("close", resolve);
    });
    if (code !== 0) throw new Error(`${side.name} ${name} exited ${code}; inspect its log.`);
  };
  const stop = async (child) => {
    if (!child.pid) return;
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
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + 10_000;
    while (alive() && Date.now() < deadline) await delay(100);
    if (alive()) {
      process.kill(-child.pid, "SIGKILL");
      const deadline = Date.now() + 5000;
      while (alive() && Date.now() < deadline) await delay(100);
      if (alive()) throw new Error(`Owned group ${child.pid} remains alive.`);
    }
  };
  const interrupt = () => {
    interrupted = true;
    for (const child of children) {
      if (!child.pid) continue;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") receipt.interruptionCleanupError = error.message;
      }
    }
  };
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  try {
    await save();
    receipt.host.processCountersBefore = counters();
    for (const [index, name] of ["baseline", "head"].entries()) {
      const root = roots[name];
      if (git(root, ["rev-parse", "--show-toplevel"]) !== root)
        throw new Error(`${name} is not a checkout root.`);
      const sha = git(root, ["rev-parse", "HEAD"]);
      if (name === "baseline" && sha !== baselineSha)
        throw new Error("Baseline SHA is not the planned trunk.");
      if (git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...relevant]))
        throw new Error(`${name} has affected uncommitted source or manifests.`);
      for (const location of [
        root,
        join(root, "apps/web"),
        join(root, "apps/core"),
        join(root, "apps/mobile"),
      ]) {
        if (!existsSync(location)) continue;
        for (const file of await readdir(location)) {
          if (/^(\.dev\.vars|\.env)(\.|$)/.test(file) && !/(example|sample|template)$/.test(file))
            throw new Error(
              `${name} contains private environment input ${relative(root, join(location, file))}.`,
            );
        }
      }
      if (!inside(root, await realpath(join(root, "node_modules"))))
        throw new Error(`${name} shares node_modules outside its checkout.`);
      const stateName = `e2e-web-perf-${randomUUID()}`;
      const stateRoot = join(root, "apps/core/.wrangler");
      const stateDirectory = join(stateRoot, stateName);
      const port = 3100 + index;
      const side = (receipt.sides[name] = {
        name,
        root,
        sha,
        port,
        stateRoot,
        stateName,
        stateDirectory,
        stateOwned: false,
        processes: [],
        lockSha256: createHash("sha256")
          .update(await readFile(join(root, "pnpm-lock.yaml")))
          .digest("hex"),
        env: {
          ...process.env,
          CI: "1",
          E2E_AUTHENTICATED: "1",
          E2E_STATE_NAME: stateName,
          E2E_PROVIDER_GATEWAY: "0",
          FRESHMARKETS_DEV_DATA: "local",
          WRANGLER_SEND_METRICS: "false",
        },
      });
      Object.defineProperty(side, "env", { enumerable: false, value: side.env });
      await freePort(port);
      await mkdir(stateRoot, { recursive: true });
      if ((await realpath(stateRoot)) !== stateRoot || !inside(root, stateRoot))
        throw new Error("State root must resolve inside its checkout without symlinks.");
      if (dirname(stateDirectory) !== stateRoot || existsSync(stateDirectory))
        throw new Error("State ownership failed.");
      await mkdir(stateDirectory);
      side.stateOwned = true;
      const require = createRequire(join(root, "apps/web/package.json"));
      if (!inside(root, await realpath(require.resolve("wrangler-e2e/package.json"))))
        throw new Error(`${name} shares Wrangler dependencies outside its checkout.`);
      side.wranglerVersion = require("wrangler-e2e/package.json").version;
      side.pnpmVersion = execFileSync("pnpm", ["--version"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const expected = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ).packageManager.replace("pnpm@", "");
      if (side.pnpmVersion !== expected)
        throw new Error(`${name} pnpm does not match its pinned version.`);
      await run(side, "build", "pnpm", ["--filter", "@freshmarkets/web", "build"]);
      const wrangler = join(root, "apps/web/node_modules/wrangler-e2e/bin/wrangler.js");
      await run(side, "migrations", process.execPath, [
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
      side.inspectorPort = port + 20;
      await freePort(side.inspectorPort);
      side.server = start(side, "worker", process.execPath, [
        wrangler,
        "dev",
        "-c",
        "apps/web/dist/server/wrangler.json",
        "-c",
        "apps/core/wrangler.e2e.jsonc",
        "--persist-to",
        stateDirectory,
        "--port",
        String(port),
        "--inspector-port",
        String(side.inspectorPort),
        "--ip",
        "127.0.0.1",
      ]);
      Object.defineProperty(side, "server", { enumerable: false, value: side.server });
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        if (
          interrupted ||
          side.server.failure ||
          side.server.exitCode !== null ||
          side.server.signalCode !== null
        )
          throw new Error(`${name} worker startup failed.`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/core-health`, {
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          });
          if (response.status === 200) {
            const health = await response.json();
            if (
              health.service !== "core" ||
              health.status !== "ok" ||
              health.environment !== "development" ||
              health.databaseBindingConfigured !== true ||
              typeof health.contractVersion !== "string" ||
              !health.contractVersion
            )
              throw new Error("Unexpected local Core health contract.");
            side.backend = health;
            break;
          }
          side.lastReadinessStatus = response.status;
        } catch (error) {
          side.lastReadinessError = { message: error.message, causeCode: error.cause?.code };
        }
        await delay(1000);
      }
      if (!side.backend) throw new Error(`${name} local backend readiness timed out.`);
      await save();
    }
    const require = createRequire(join(roots.head, "apps/web/package.json"));
    if (!inside(roots.head, await realpath(require.resolve("@playwright/test/package.json"))))
      throw new Error("Head shares Playwright dependencies outside its checkout.");
    const { chromium, expect } = require("@playwright/test");
    receipt.browser = {
      playwrightVersion: require("@playwright/test/package.json").version,
      executable: chromium.executablePath(),
    };
    const trial = async (order, profile = false) => {
      const side = receipt.sides[order.side];
      const sample = {
        ...order,
        sha: side.sha,
        status: "running",
        errors: { http: [], requests: [], page: [] },
      };
      (profile ? receipt.profiles : receipt.trials).push(sample);
      let cdp;
      let traceComplete;
      let page;
      try {
        if (interrupted) throw new Error("Paired measurement interrupted.");
        activeBrowser = await chromium.launch({ headless: true });
        sample.browserVersion = activeBrowser.version();
        const system = await activeBrowser.newBrowserCDPSession();
        const info = await system.send("SystemInfo.getProcessInfo");
        sample.browserPID = info.processInfo.find((item) => item.type === "browser")?.id;
        if (!sample.browserPID) throw new Error("Cannot identify the actual Chromium process.");
        if (receipt.browser.version && receipt.browser.version !== sample.browserVersion)
          throw new Error("Browser version changed between trials.");
        receipt.browser.version = sample.browserVersion;
        const context = await activeBrowser.newContext({
          viewport: { width: 1280, height: 900 },
          locale: "en-PH",
          reducedMotion: "reduce",
        });
        const point = { latitude: 10.32, longitude: 123.9 };
        await context.addCookies([
          {
            name: "freshmarkets_browse_point_v2",
            value: encodeURIComponent(JSON.stringify(point)),
            url: `http://127.0.0.1:${side.port}`,
            sameSite: "Lax",
          },
        ]);
        await context.addInitScript(
          (coordinate) =>
            localStorage.setItem(
              "freshmarkets.delivery-location.v3",
              JSON.stringify({ displayAddress: "Synthetic selected location", coordinate }),
            ),
          point,
        );
        page = await context.newPage();
        page.setDefaultTimeout(30_000);
        page.on("response", (response) => {
          if (response.status() >= 400)
            sample.errors.http.push({
              path: new URL(response.url()).pathname,
              status: response.status(),
            });
        });
        page.on("requestfailed", (request) =>
          sample.errors.requests.push({
            path: new URL(request.url()).pathname,
            failure: request.failure()?.errorText,
          }),
        );
        page.on("pageerror", (error) => sample.errors.page.push(error.message));
        if (profile) {
          cdp = await context.newCDPSession(page);
          traceComplete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
          await cdp.send("Tracing.start", {
            categories: "devtools.timeline,v8,blink.user_timing",
            transferMode: "ReturnAsStream",
          });
          sample.processCountersBefore = counters();
        }
        const response = await page.goto(`http://127.0.0.1:${side.port}/`, {
          waitUntil: "domcontentloaded",
        });
        if (response?.status() !== 200)
          throw new Error(`Navigation returned ${response?.status()}.`);
        await expect(page.getByRole("dialog", { name: "FreshMarkets welcome" })).toBeVisible();
        await page.getByRole("button", { name: "Close welcome announcement", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Fruits", exact: true })).toBeVisible();
        const card = page.getByRole("article").filter({ hasText: "Baguio Strawberries" }).first();
        await expect(card.getByRole("heading", { name: "Baguio Strawberries" })).toBeVisible();
        const price = card.locator("p");
        await expect(price).toBeVisible();
        await expect(price).toHaveText("₱179.00 / 500 g");
        sample.timing = await page.evaluate(async () => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const navigation = performance.getEntriesByType("navigation")[0];
          return {
            elapsedMs: performance.now() - navigation.startTime,
            phases: {
              requestStartMs: navigation.requestStart,
              responseStartMs: navigation.responseStart,
              responseEndMs: navigation.responseEnd,
              domContentLoadedMs: navigation.domContentLoadedEventEnd,
            },
            timeOrigin: performance.timeOrigin,
          };
        });
        sample.semanticEvidence = {
          category: await page.getByRole("heading", { name: "Fruits", exact: true }).innerText(),
          product: await card.getByRole("heading", { name: "Baguio Strawberries" }).innerText(),
          price: await price.innerText(),
          welcomeDismissed: !(await page
            .getByRole("dialog", { name: "FreshMarkets welcome" })
            .isVisible()),
          navigationStatus: response.status(),
        };
        await page.waitForLoadState("networkidle", { timeout: 10_000 });
        if (profile) {
          sample.processCountersAfter = counters();
          await cdp.send("Tracing.end");
          const { stream } = await traceComplete;
          const file = createWriteStream(join(directory, `${order.side}-profile.json`));
          while (true) {
            const part = await cdp.send("IO.read", { handle: stream });
            file.write(part.base64Encoded ? Buffer.from(part.data, "base64") : part.data);
            if (part.eof) break;
          }
          await new Promise((resolve, reject) => {
            file.once("error", reject);
            file.end(resolve);
          });
          await cdp.send("IO.close", { handle: stream });
          sample.trace = `${order.side}-profile.json`;
        }
        if (Object.values(sample.errors).some((errors) => errors.length))
          throw new Error("The trial observed HTTP, request, or page failures.");
        if (profile || (order.phase === "measured" && order.pair === 30)) {
          sample.screenshot = `${order.side}-${profile ? "profile" : "measured"}.png`;
          await page.screenshot({ path: join(directory, sample.screenshot), fullPage: true });
        }
        sample.status = "passed";
      } catch (error) {
        sample.status = "failed";
        sample.error = error.message;
        if (page && !page.isClosed()) {
          try {
            const card = page
              .getByRole("article")
              .filter({ hasText: "Baguio Strawberries" })
              .first();
            sample.failedObservation = {
              path: new URL(page.url()).pathname,
              cardText: (await card.count()) ? (await card.innerText()).slice(0, 1000) : null,
              selectedCoordinate: await page.evaluate(() => {
                const selected = localStorage.getItem("freshmarkets.delivery-location.v3");
                return selected ? JSON.parse(selected).coordinate : null;
              }),
            };
            sample.screenshot = `${order.side}-${order.phase}-${order.pair}-failed.png`;
            await page.screenshot({ path: join(directory, sample.screenshot), fullPage: true });
            const response = await page.request.get(
              `http://127.0.0.1:${side.port}/api/catalog?home=1`,
              {
                timeout: 5000,
              },
            );
            const payload = await response.json();
            sample.failedObservation.catalog = {
              status: response.status(),
              products: (payload.value?.marketplace?.rails ?? [])
                .flatMap((rail) => rail.items)
                .filter((product) => product.name === "Baguio Strawberries")
                .map((product) => ({
                  name: product.name,
                  variants: product.variants.map(
                    ({ name, priceMinor, currency, availability }) => ({
                      name,
                      priceMinor,
                      currency,
                      availability,
                    }),
                  ),
                })),
            };
          } catch (diagnosticError) {
            sample.diagnosticError = diagnosticError.message;
          }
        }
        throw error;
      } finally {
        if (activeBrowser) {
          await activeBrowser.close();
          activeBrowser = undefined;
          sample.browserClosed = true;
        }
        await save();
      }
    };
    for (const order of trialOrder()) await trial(order);
    for (const name of ["baseline", "head"]) {
      receipt.sides[name].summary = summarize(
        receipt.trials
          .filter((sample) => sample.side === name && sample.phase === "measured")
          .map((sample) => sample.timing.elapsedMs),
      );
      await trial({ side: name, phase: "profile", pair: 1 }, true);
    }
    receipt.gate = regressionGate(receipt.sides.baseline.summary, receipt.sides.head.summary);
    receipt.interpretation =
      "Only the prescribed regression threshold is evaluated. No faster/slower or bottleneck claim is made automatically. Review the separate CDP traces, CPU snapshots, response phases, and spread before interpreting a difference.";
    if (receipt.gate.regression)
      throw new Error("Comparable Web p95 breached both regression thresholds.");
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error.message;
    process.exitCode = 1;
  } finally {
    if (interrupted) {
      receipt.status = "failed";
      receipt.error = "Paired measurement interrupted.";
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
    if (activeBrowser) await clean("browser", () => activeBrowser.close());
    let stopped = true;
    for (const child of children)
      stopped = (await clean(`process-${child.pid}`, () => stop(child))) && stopped;
    for (const side of Object.values(receipt.sides)) {
      const portFree = await clean(`${side.name}-ports`, () =>
        Promise.all([
          freePort(side.port),
          ...(side.inspectorPort ? [freePort(side.inspectorPort)] : []),
        ]),
      );
      if (side.stateOwned && stopped && portFree)
        await clean(`${side.name}-state`, async () => {
          if (
            dirname(side.stateDirectory) !== side.stateRoot ||
            !/^e2e-web-perf-[a-f0-9-]+$/.test(side.stateName) ||
            !inside(side.root, side.stateDirectory) ||
            (await realpath(side.stateDirectory)) !== side.stateDirectory
          )
            throw new Error("Unsafe state cleanup path.");
          await rm(side.stateDirectory, { recursive: true });
        });
      else if (side.stateOwned)
        receipt.cleanup[`${side.name}-state`] =
          "Retained because process cleanup or port checks failed.";
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.counts = {
      plannedWarmups: 10,
      plannedMeasuredTrials: 60,
      attemptedTrials: receipt.trials.length,
      passedTrials: receipt.trials.filter((sample) => sample.status === "passed").length,
      failedTrials: receipt.trials.filter((sample) => sample.status === "failed").length,
      observedErrors: Object.fromEntries(
        ["http", "requests", "page"].map((kind) => [
          kind,
          receipt.trials.reduce((count, sample) => count + sample.errors[kind].length, 0),
        ]),
      ),
      profiles: receipt.profiles.length,
    };
    receipt.host.loadAverageAfter = os.loadavg();
    await save();
    console.log(`Paired Web ${receipt.status}. Evidence ${directory}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

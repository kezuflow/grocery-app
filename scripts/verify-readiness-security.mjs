import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = process.cwd();
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const findings = [];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc"]);
const isSource = (file) => sourceExtensions.has(extname(file));
const isTest = (file) => /(?:\.test|\.spec)\.[^.]+$/.test(file);

function finding(file, rule, line) {
  findings.push(`${file}${line ? `:${line}` : ""} — ${rule}`);
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

for (const file of files) {
  if (!isSource(file) || file.includes("worker-configuration.d.ts")) continue;
  const content = await readFile(`${root}/${file}`, "utf8");

  const secretPatterns = [
    /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  ];
  for (const pattern of secretPatterns) {
    const match = pattern.exec(content);
    if (match) finding(file, "committed credential pattern", lineNumber(content, match.index));
  }

  if (file.startsWith("apps/web/") && !isTest(file)) {
    for (const pattern of [
      /from\s+["']drizzle-orm\/d1["']/,
      /\bD1Database\b/,
      /from\s+["'][^"']*\/schema["']/,
    ]) {
      const match = pattern.exec(content);
      if (match)
        finding(
          file,
          "Web must not import Core D1/schema infrastructure",
          lineNumber(content, match.index),
        );
    }
  }

  if (!isTest(file)) {
    const cors = /Access-Control-Allow-Origin|access-control-allow-origin/.exec(content);
    if (cors)
      finding(
        file,
        "general CORS surface requires explicit architecture approval",
        lineNumber(content, cors.index),
      );
  }
}

for (const file of files.filter((item) => /wrangler\.jsonc$/.test(item))) {
  const content = await readFile(`${root}/${file}`, "utf8");
  if (
    /ENVIRONMENT["']?\s*:\s*["']production["']/i.test(content) &&
    /PAYMENT_PROVIDER["']?\s*:\s*["']mock["']/i.test(content)
  ) {
    finding(file, "production configuration must not inherit the mock payment provider");
  }
  if (
    /ENVIRONMENT["']?\s*:\s*["']production["']/i.test(content) &&
    /https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(content)
  ) {
    finding(file, "production configuration must not use loopback origins");
  }
}

if (findings.length) {
  console.error("Readiness security verification failed:");
  for (const item of findings) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log("Readiness security verification passed.");
  console.log(
    "Exceptions: generated Web worker types are excluded; test fixtures are excluded from production-secret/CORS scans.",
  );
}

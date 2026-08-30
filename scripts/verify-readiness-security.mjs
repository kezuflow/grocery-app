import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenLogFields = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "token",
  "accesstoken",
  "refreshtoken",
  "clienttoken",
  "secret",
  "password",
  "rawbody",
  "webhookbody",
  "providerpayload",
  "payload",
  "actionurl",
  "resetlink",
  "addresssnapshot",
  "addresssnapshotjson",
]);
const directConsoleAllowlist = new Set([
  "apps/core/src/observability.ts",
  "apps/core/src/payments/application/financial-observability.ts",
]);

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function tokens(sourceText) {
  const scanner = createScanner(true, LanguageVariant.Standard, sourceText);
  const result = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    result.push({ kind, start: scanner.getTokenStart(), text: scanner.getTokenText() });
  }
  return result;
}

function lineAt(sourceText, position) {
  return sourceText.slice(0, position).split("\n").length;
}

function logCallTokens(sourceTokens, startIndex) {
  const result = [];
  let depth = 0;
  for (let index = startIndex + 1; index < sourceTokens.length; index += 1) {
    const token = sourceTokens[index];
    result.push(token);
    if (token.kind === SyntaxKind.OpenParenToken) depth += 1;
    if (token.kind === SyntaxKind.CloseParenToken) {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return result;
}

export function analyzeSecuritySource(fileNameInput, sourceText) {
  const fileName = normalize(fileNameInput);
  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".test.ts") ||
    fileName.endsWith(".integration.test.ts")
  )
    return [];
  const sourceTokens = tokens(sourceText);
  const violations = [];

  for (let index = 0; index < sourceTokens.length; index += 1) {
    const token = sourceTokens[index];
    const next = sourceTokens[index + 1];
    const previous = sourceTokens[index - 1];

    if (
      token.text === "console" &&
      next?.kind === SyntaxKind.DotToken &&
      !directConsoleAllowlist.has(fileName)
    ) {
      violations.push({
        code: "DIRECT_CONSOLE",
        file: fileName,
        line: lineAt(sourceText, token.start),
        message: "Production Core telemetry must cross a redacted observability boundary",
      });
    }

    if (
      token.text !== "log" ||
      next?.kind !== SyntaxKind.OpenParenToken ||
      previous?.kind === SyntaxKind.DotToken ||
      fileName === "apps/core/src/observability.ts"
    ) {
      continue;
    }

    for (const callToken of logCallTokens(sourceTokens, index)) {
      if (callToken.kind !== SyntaxKind.Identifier) continue;
      const normalized = callToken.text.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
      if (!forbiddenLogFields.has(normalized)) continue;
      violations.push({
        code: "SENSITIVE_LOG_FIELD",
        file: fileName,
        line: lineAt(sourceText, callToken.start),
        message: `Sensitive field ${callToken.text} must not be passed to log()`,
      });
    }
  }
  return violations;
}

export function verifyReadinessSurface(files) {
  const common = files.get("packages/contracts/src/common.ts") ?? "";
  const service = files.get("packages/contracts/src/core-service.ts") ?? "";
  const entrypoint = files.get("apps/core/src/index.ts") ?? "";
  const failures = [];
  if (!common.includes("CoreReadinessResponse")) failures.push("Readiness DTO is missing");
  if (!service.includes('"readiness"')) failures.push("Readiness RPC is missing from the manifest");
  if (!entrypoint.includes('path === "/health"')) failures.push("Liveness route is missing");
  if (!entrypoint.includes('path === "/ready"')) failures.push("Readiness route is missing");
  if (!entrypoint.includes("SELECT 1 AS ready"))
    failures.push("Bounded D1 readiness probe is missing");
  return failures;
}

export function verifyObservabilityConfig(source, name) {
  const configuration = JSON.parse(
    source.replace(/^\s*\/\/.*$/gmu, "").replace(/,\s*([}\]])/gu, "$1"),
  );
  const observability = configuration.observability;
  if (
    observability?.enabled !== true ||
    observability.logs?.enabled !== true ||
    observability.logs?.invocation_logs !== true ||
    observability.logs?.head_sampling_rate !== 1 ||
    observability.traces?.enabled !== true ||
    observability.traces?.head_sampling_rate !== 0.05
  ) {
    return [`${name} observability must explicitly retain all logs and sample 5% of traces`];
  }
  return [];
}

function trackedSources() {
  return execFileSync("git", ["ls-files", "apps/core/src/**/*.ts", "apps/core/src/*.ts"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(normalize);
}

function main() {
  const files = new Map();
  for (const fileName of [
    "packages/contracts/src/common.ts",
    "packages/contracts/src/core-service.ts",
    "apps/core/src/index.ts",
  ]) {
    files.set(fileName, readFileSync(path.join(repositoryRoot, fileName), "utf8"));
  }
  const failures = verifyReadinessSurface(files);
  for (const configFile of ["apps/core/wrangler.jsonc", "apps/web/wrangler.jsonc"]) {
    failures.push(
      ...verifyObservabilityConfig(
        readFileSync(path.join(repositoryRoot, configFile), "utf8"),
        configFile,
      ),
    );
  }
  const violations = trackedSources().flatMap((fileName) =>
    analyzeSecuritySource(fileName, readFileSync(path.join(repositoryRoot, fileName), "utf8")),
  );
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  for (const violation of violations) {
    process.stderr.write(
      `${violation.file}:${violation.line} ${violation.code} ${violation.message}\n`,
    );
  }
  if (failures.length || violations.length) process.exitCode = 1;
  else process.stdout.write("Readiness and observability boundaries verified.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

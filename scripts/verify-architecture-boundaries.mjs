import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const messages = {
  WEB_IMPORTS_CORE:
    "Web source must communicate with Core through shared contracts and Service Bindings",
  CONTRACT_IMPORTS_INFRASTRUCTURE:
    "Shared contracts must not depend on application or infrastructure implementation types",
  DOMAIN_IMPORTS_OUTWARD:
    "Domain source must not import application, repository, transport, or provider implementation layers",
  APPLICATION_IMPORTS_TRANSPORT: "Application source must not import Web or transport entrypoints",
  PROVIDER_LEAK: "Payment provider adapters and identifiers must remain owned by Payments",
  ENTRYPOINT_SQL: "Core entrypoint adapters must delegate instead of executing SQL",
  CONTRACT_EXPORTS_ROW: "Shared contracts must export DTOs and read models, not database row types",
};

const productionSourcePattern = /^(apps|packages)\/.*\.(?:[cm]?ts|tsx)$/;

// Provider construction belongs only at Worker/scheduler composition roots.
// Application and domain code consume the Payments-owned registry port.
const providerAdapterCompositionRoots = new Set([
  "apps/core/src/index.ts",
  "apps/core/src/scheduling/run-scheduled-jobs.ts",
]);

function normalizeFileName(fileName) {
  return fileName.replaceAll("\\", "/");
}

function tokenize(sourceText) {
  const scanner = createScanner(true, LanguageVariant.Standard, sourceText);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({
      kind,
      start: scanner.getTokenStart(),
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  }
  return tokens;
}

function sourceLine(sourceText, position) {
  let line = 1;
  for (let index = 0; index < position; index += 1) {
    if (sourceText.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function importedModules(tokens) {
  const imports = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== SyntaxKind.StringLiteral) continue;
    const previous = tokens[index - 1];
    const beforePrevious = tokens[index - 2];
    if (
      previous?.kind === SyntaxKind.ImportKeyword ||
      previous?.kind === SyntaxKind.FromKeyword ||
      (previous?.kind === SyntaxKind.OpenParenToken &&
        (beforePrevious?.kind === SyntaxKind.ImportKeyword || beforePrevious?.text === "require"))
    ) {
      imports.push({ moduleName: token.value, position: token.start });
    }
  }
  return imports;
}

function resolvesInto(fileName, moduleName, directory) {
  if (!moduleName.startsWith(".")) return false;
  const resolved = normalizeFileName(path.resolve(path.dirname(fileName), moduleName));
  return resolved.includes(`/${directory}/`) || resolved.endsWith(`/${directory}`);
}

function hasSegment(value, segments) {
  return segments.some((segment) =>
    new RegExp(`(?:^|/)${segment}(?:/|$)`, "u").test(normalizeFileName(value)),
  );
}

export function analyzeSourceFile(fileNameInput, sourceText) {
  const fileName = normalizeFileName(fileNameInput);
  const tokens = tokenize(sourceText);
  const violations = [];
  const seen = new Set();

  const add = (code, position) => {
    const key = `${code}:${position}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      code,
      file: fileName,
      line: sourceLine(sourceText, position),
      message: messages[code],
    });
  };

  for (const imported of importedModules(tokens)) {
    const moduleName = normalizeFileName(imported.moduleName);

    if (
      fileName.startsWith("apps/web/") &&
      (moduleName.startsWith("@freshmarkets/core") ||
        resolvesInto(fileName, moduleName, "apps/core"))
    ) {
      add("WEB_IMPORTS_CORE", imported.position);
    }

    if (
      fileName.startsWith("packages/contracts/") &&
      (/(?:^|\/)(?:apps|infrastructure|schema|schemas|database|db)(?:\/|$)/u.test(moduleName) ||
        /(?:cloudflare|workers-types|drizzle|d1)/iu.test(moduleName))
    ) {
      add("CONTRACT_IMPORTS_INFRASTRUCTURE", imported.position);
    }

    if (
      fileName.includes("/domain/") &&
      (hasSegment(moduleName, [
        "application",
        "infrastructure",
        "repository",
        "http",
        "entrypoint",
        "transport",
        "providers?",
      ]) ||
        ["application", "infrastructure", "repository", "http", "entrypoint", "transport"].some(
          (directory) => resolvesInto(fileName, moduleName, directory),
        ))
    ) {
      add("DOMAIN_IMPORTS_OUTWARD", imported.position);
    }

    if (
      fileName.includes("/application/") &&
      (hasSegment(moduleName, ["http", "entrypoint", "transport", "apps/web"]) ||
        ["http", "entrypoint", "transport", "apps/web"].some((directory) =>
          resolvesInto(fileName, moduleName, directory),
        ))
    ) {
      add("APPLICATION_IMPORTS_TRANSPORT", imported.position);
    }

    if (
      fileName.startsWith("apps/core/src/") &&
      !fileName.startsWith("apps/core/src/payments/") &&
      !fileName.endsWith(".test.ts") &&
      !fileName.endsWith(".integration.test.ts") &&
      !providerAdapterCompositionRoots.has(fileName) &&
      (/(?:^|\/)(?:xendit|stripe|adyen)(?:\/|$)/iu.test(moduleName) ||
        /payments\/infrastructure\/(?:providers?|adapters?)/iu.test(moduleName))
    ) {
      add("PROVIDER_LEAK", imported.position);
    }
  }

  if (fileName === "apps/core/src/index.ts" || fileName.startsWith("apps/core/src/entrypoint/")) {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      if (token.text === "prepare" && previous?.kind === SyntaxKind.DotToken) {
        add("ENTRYPOINT_SQL", token.start);
      }
    }
  }

  if (fileName.startsWith("packages/contracts/src/") && !fileName.endsWith(".test.ts")) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].kind !== SyntaxKind.ExportKeyword) continue;
      for (let offset = 1; offset <= 20 && index + offset < tokens.length; offset += 1) {
        const token = tokens[index + offset];
        if (offset > 1 && token.kind === SyntaxKind.ExportKeyword) break;
        if (token.kind === SyntaxKind.SemicolonToken) break;
        if (token.kind === SyntaxKind.Identifier && /Row$/u.test(token.text)) {
          add("CONTRACT_EXPORTS_ROW", token.start);
          break;
        }
      }
    }
  }

  return violations.sort(
    (left, right) => left.line - right.line || left.code.localeCompare(right.code),
  );
}

export function trackedProductionSources() {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .map(normalizeFileName)
    .filter((fileName) => productionSourcePattern.test(fileName) && !fileName.endsWith(".d.ts"));
}

export function verifyRepository() {
  return trackedProductionSources().flatMap((fileName) =>
    analyzeSourceFile(fileName, readFileSync(path.join(repositoryRoot, fileName), "utf8")),
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const violations = verifyRepository();
  if (violations.length > 0) {
    for (const item of violations) {
      console.error(`${item.file}:${item.line} ${item.code} ${item.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Architecture boundaries verified for tracked TypeScript sources.");
  }
}

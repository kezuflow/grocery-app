import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const files = [...new Set([...tracked, ...untracked])];

const retiredStageLabel = /(^|[^a-z])mvp([^a-z]|$)/i;
const immutableMigration = /^apps\/core\/migrations\//i;
const historicalDocument = /^docs\/superpowers\/(plans|reports|specs)\//i;
const historicalReview = /^docs\/product\/PHASE_REVIEW_/i;
const historicalExecutionArtifact = /^\.superpowers\/sdd\//i;
const enforcementSource = "scripts/verify-product-terminology.mjs";
const immutableMigrationReference = /\b\d{4}_[a-z0-9_]*mvp[a-z0-9_]*\.sql\b/gi;
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const violations = [];
const reviewedHistory = [];

for (const file of files) {
  if (!textExtensions.has(extname(file).toLowerCase()) && !/^(AGENTS|CLAUDE)\.md$/i.test(file)) {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const activeContent = content.replace(immutableMigrationReference, "applied-migration.sql");
  if (!retiredStageLabel.test(file) && !retiredStageLabel.test(activeContent)) continue;

  if (
    immutableMigration.test(file) ||
    historicalDocument.test(file) ||
    historicalReview.test(file) ||
    historicalExecutionArtifact.test(file) ||
    file === enforcementSource
  ) {
    reviewedHistory.push(file);
  } else {
    violations.push(file);
  }
}

for (const file of reviewedHistory.sort()) {
  process.stdout.write(`Historical terminology reviewed: ${file}\n`);
}

if (violations.length > 0) {
  process.stderr.write(`Active product terminology violation:\n${violations.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Product terminology verified.\n");
}

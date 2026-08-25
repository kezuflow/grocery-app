import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".wrangler",
  "node_modules",
  "dist",
  ".next",
  "coverage",
]);
const allowedDirectoryNames = new Set([
  ".github",
  "app",
  "apps",
  "packages",
  "docs",
  "scripts",
  "src",
  "public",
  "components",
  "lib",
  "ui",
  "auth",
  "catalog",
  "commerce",
  "geography",
  "core-client",
  "architecture",
  "product",
  "design",
  "admin",
  "marketplace",
  "migrations",
  "account",
  "api",
  "products",
  "serviceability",
  "checkout",
  "cart",
  "orders",
  "rider",
  "operations",
]);
const routeDirectoryPattern = /^(?:\[\[?\.\.\.[a-z][a-z0-9-]*\]?\]?|\[[a-z][a-z0-9-]*\])$/;
const sourceFilePattern =
  /^[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\.(?:test|spec))?\.(?:ts|tsx|js|jsx|mjs|cjs|css|json|jsonc)$/;
const migrationPattern = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const docPattern = /^[A-Z][A-Z0-9_]*\.md$/;
const violations = [];

function display(path) {
  return relative(root, path).split(sep).join("/");
}

function fail(path, rule) {
  violations.push(`${display(path)}: ${rule}`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const isRouteDirectory = routeDirectoryPattern.test(entry.name);
      const isKebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name);
      const isKnownDirectory = allowedDirectoryNames.has(entry.name);
      if (!isRouteDirectory && !isKebab && !isKnownDirectory) {
        fail(path, "directories must use lowercase kebab-case");
      }
      await walk(path);
      continue;
    }

    const normalized = entry.name;
    if (normalized === "worker-configuration.d.ts") continue;
    if (
      normalized === "package.json" ||
      normalized === "pnpm-lock.yaml" ||
      normalized === "pnpm-workspace.yaml"
    )
      continue;
    if (path.includes(`${sep}migrations${sep}`) && normalized.endsWith(".sql")) {
      if (!migrationPattern.test(normalized))
        fail(path, "D1 migrations must match NNNN_lower_snake_case.sql");
      continue;
    }
    if (path.includes(`${sep}docs${sep}`) && normalized.endsWith(".md")) {
      if (!docPattern.test(normalized))
        fail(path, "canonical Markdown docs must use uppercase names with underscores");
      continue;
    }
    if (
      normalized.endsWith(".ts") ||
      normalized.endsWith(".tsx") ||
      normalized.endsWith(".js") ||
      normalized.endsWith(".jsx") ||
      normalized.endsWith(".mjs") ||
      normalized.endsWith(".cjs") ||
      normalized.endsWith(".css") ||
      normalized.endsWith(".jsonc")
    ) {
      if (!sourceFilePattern.test(normalized))
        fail(path, "source files must use lowercase kebab-case, with optional .test/.spec");
    }
  }
}

async function verifyPackages() {
  const packageFiles = [];
  async function find(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await find(path);
      else if (entry.name === "package.json") packageFiles.push(path);
    }
  }
  await find(root);
  for (const path of packageFiles) {
    const packageJson = JSON.parse(await readFile(path, "utf8"));
    if (
      path !== join(root, "package.json") &&
      !/^@freshmarkets\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packageJson.name ?? "")
    ) {
      fail(path, "workspace package names must use @freshmarkets/lowercase-kebab-case");
    }
  }
}

await walk(root);
await verifyPackages();

if (violations.length) {
  console.error("Naming convention violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "Naming conventions verified: source paths, migrations, docs, and workspace packages are compliant.",
  );
}

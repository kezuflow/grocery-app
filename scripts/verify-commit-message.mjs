import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const allowedTypes = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "test",
]);

function validate(subject) {
  const match =
    /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?(?<breaking>!)?: (?<description>[^\s].*)$/.exec(
      subject,
    );
  if (!match) {
    return "must match `<type>(<scope>)?: <description>`; append `!` for breaking changes";
  }
  if (!allowedTypes.has(match.groups.type)) {
    return `type '${match.groups.type}' is not allowed; use one of ${[...allowedTypes].join(", ")}`;
  }
  if (match.groups.description.endsWith(".")) {
    return "description must not end with a period";
  }
  return null;
}

function readSubjectsFromRange(range) {
  return execFileSync("git", ["log", "--format=%s", range], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

async function readSubjects() {
  if (process.argv[2] === "--range") {
    if (!process.argv[3]) throw new Error("Missing git range after --range");
    return readSubjectsFromRange(process.argv[3]);
  }
  const messagePath = process.argv[2];
  if (messagePath) return [(await readFile(messagePath, "utf8")).split(/\r?\n/, 1)[0].trim()];
  return [execFileSync("git", ["show", "-s", "--format=%s", "HEAD"], { encoding: "utf8" }).trim()];
}

const subjects = await readSubjects();
const failures = subjects
  .map((subject) => ({ subject, error: validate(subject) }))
  .filter(({ error }) => error);
if (failures.length) {
  console.error("Invalid commit messages:");
  for (const { subject, error } of failures) {
    console.error(`- '${subject || "<empty>"}': ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${subjects.length} commit message${subjects.length === 1 ? "" : "s"}.`);

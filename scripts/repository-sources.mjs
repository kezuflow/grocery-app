import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Inspect working-tree content, including new files before staging. Keep tracked
// files even when an ignore rule later matches them; omit locally deleted files.
export function repositorySources(root, directories) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...directories],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((fileName) => /\.(?:[cm]?ts|tsx)$/u.test(fileName))
    .filter((fileName) => !/\.d\.[cm]?ts$/u.test(fileName))
    .filter((fileName) => existsSync(path.join(root, fileName)))
    .sort();
}

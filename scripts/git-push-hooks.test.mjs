import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

test("pre-push enforces PR branches and commit subjects on real pushes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "freshmarkets-push-"));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const repository = join(directory, "checkout");
  const remote = join(directory, "remote.git");
  mkdirSync(repository);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: "pipe" });
  git("init", "--bare", remote);
  git("init", "--initial-branch=main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Push fixture");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", remote);
  writeFileSync(join(repository, "README.md"), "Push fixture\n");
  git("add", "README.md");
  git("commit", "-m", "docs: initialize fixture");
  git("push", "origin", "main");
  mkdirSync(join(repository, "scripts"));
  for (const name of ["verify-naming.mjs", "verify-commit-message.mjs"]) {
    cpSync(join(process.cwd(), "scripts", name), join(repository, "scripts", name));
  }
  mkdirSync(join(repository, ".githooks"));
  cpSync(join(process.cwd(), ".githooks/pre-push"), join(repository, ".githooks/pre-push"));
  chmodSync(join(repository, ".githooks/pre-push"), 0o755);
  git("config", "core.hooksPath", ".githooks");
  const push = (branch) =>
    spawnSync("git", ["push", "origin", branch], { cwd: repository, encoding: "utf8" });
  const branchWithCommit = (branch, subject) => {
    git("checkout", "-b", branch, "main");
    git("commit", "--allow-empty", "-m", subject);
  };

  await t.test("accepts an initial codex PR branch", () => {
    branchWithCommit("codex/valid", "feat: add valid fixture");
    const result = push("codex/valid");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 1 commit message/);
    assert.equal(
      git("ls-remote", "origin", "refs/heads/codex/valid").split("\t")[0],
      git("rev-parse", "HEAD").trim(),
    );
  });
  await t.test("rejects a noncodex branch", () => {
    branchWithCommit("feature/rejected", "feat: add rejected fixture");
    const result = push("feature/rejected");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /use a codex\/ PR branch/);
    assert.equal(git("ls-remote", "origin", "refs/heads/feature/rejected"), "");
  });
  await t.test("rejects invalid subjects on the initial PR push", () => {
    branchWithCommit("codex/invalid", "bad subject");
    const result = push("codex/invalid");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid commit messages/);
    assert.equal(git("ls-remote", "origin", "refs/heads/codex/invalid"), "");
  });
  await t.test("rejects invalid subjects on an existing PR branch", () => {
    git("checkout", "codex/valid");
    git("commit", "--allow-empty", "-m", "bad followup");
    const before = git("ls-remote", "origin", "refs/heads/codex/valid");
    const result = push("codex/valid");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid commit messages/);
    assert.equal(git("ls-remote", "origin", "refs/heads/codex/valid"), before);
  });
  await t.test("preserves checks on authorized main pushes", () => {
    git("checkout", "main");
    git("commit", "--allow-empty", "-m", "docs: update fixture");
    const result = push("main");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 1 commit message/);
  });
  await t.test("rejects a PR push containing a naming violation", () => {
    git("checkout", "-b", "codex/invalid-name", "main");
    writeFileSync(join(repository, "BadFile.ts"), "export {};\n");
    git("add", "BadFile.ts");
    git("commit", "-m", "feat: add naming fixture");
    const result = push("codex/invalid-name");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Naming convention/);
    assert.equal(git("ls-remote", "origin", "refs/heads/codex/invalid-name"), "");
  });
  await t.test("rejects an initial PR push without the trunk baseline", () => {
    branchWithCommit("codex/no-baseline", "feat: add baseline fixture");
    git("update-ref", "-d", "refs/remotes/origin/main");
    const result = push("codex/no-baseline");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fetch origin\/main/);
    assert.equal(git("ls-remote", "origin", "refs/heads/codex/no-baseline"), "");
  });
});

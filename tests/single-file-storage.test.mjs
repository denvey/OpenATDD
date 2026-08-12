import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { artifactLocator, gitPrivateRoot } from "../skills/openatdd/scripts/lib.mjs";
import { createTask, loadTask, taskFiles } from "../skills/openatdd/scripts/workflow.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...argv) {
  return execFileAsync("git", argv, { cwd });
}

test("a Git repository exposes exactly one task file and keeps runtime private", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "openatdd-git-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q");
  await createTask(root, "one-visible-file", "Keep exactly one task artifact visible");

  const files = taskFiles(root, "one-visible-file");
  const status = (await git(root, "status", "--short")).stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(status.includes("?? .openatdd/"));
  assert(!status.some((line) => line.includes("state.json") || line.includes("evidence/") || line.includes("tasks/")));
  const visible = (await execFileAsync("find", [path.join(root, ".openatdd"), "-type", "f"])).stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(visible.some((file) => file === files.requirement));
  assert.equal(visible.filter((file) => file.includes(`${path.sep}requirements${path.sep}`)).length, 1);
  assert(!visible.some((file) => file.includes(`${path.sep}tasks${path.sep}`)));
  assert(files.state.startsWith(gitPrivateRoot(root)));
  assert.equal(artifactLocator(root, files.state), "git:tasks/one-visible-file/state.json");
  assert.match(await readFile(files.requirement, "utf8"), /Human acceptance entry/);
  assert.equal((await loadTask(root, "one-visible-file")).state.taskId, "one-visible-file");
});

test("a linked worktree resolves its own Git-private runtime outside the worktree", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "openatdd-worktree-storage-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const primary = path.join(parent, "primary");
  const linked = path.join(parent, "linked");
  await execFileAsync("git", ["init", "-q", primary]);
  await git(primary, "config", "user.email", "openatdd@example.test");
  await git(primary, "config", "user.name", "OpenATDD Test");
  await execFileAsync("touch", [path.join(primary, ".gitkeep")]);
  await git(primary, "add", ".gitkeep");
  await git(primary, "commit", "-qm", "initial");
  await git(primary, "worktree", "add", "-qb", "linked-test", linked);

  await createTask(linked, "linked-runtime", "Keep linked-worktree runtime Git-private");
  const files = taskFiles(linked, "linked-runtime");
  assert(files.state.startsWith(gitPrivateRoot(linked)));
  assert(!files.state.startsWith(path.join(linked, ".git")));
  assert.match((await git(linked, "status", "--short")).stdout, /\.openatdd\//);
  assert(!((await git(linked, "status", "--short")).stdout.includes("state.json")));
  assert.equal((await loadTask(linked, "linked-runtime")).state.phase, "ACCEPTANCE_DRAFT");
});

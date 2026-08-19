import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("orchestration docs describe the one-time parallel directive and adapter contract", async () => {
  const [skill, orchestration, governance, verification, readme] = await Promise.all([
    read("skills/openatdd/SKILL.md"),
    read("skills/openatdd/references/orchestration.md"),
    read("skills/openatdd/references/governance.md"),
    read("skills/openatdd/references/verification-routing.md"),
    read("README.md"),
  ]);
  const docs = [skill, orchestration, governance, verification, readme].join("\n");

  for (const phrase of [
    "approve-solution TASK --begin --parallel",
    "solution SHA",
    "stage",
    "dependsOn",
    "writeScope",
    "create_thread",
    "send_message_to_thread",
    "wait_threads",
    "read_thread",
    "session-record",
    "session-result",
    "orchestration-integrate",
    "orchestration-cleanup",
    "shared interface contract",
    "15-minute",
    "minimal-contract-repair",
    "controller-sequential",
    "replan",
    "forkTurns:none",
    "canSpawnAgents=false",
    "failed",
    "blocked",
    "needs_input",
    "stale",
    "conflict",
    "Sol/xhigh",
    "Quick",
    "single-session",
    "fail closed",
  ]) {
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), phrase);
  }

  assert.match(orchestration, /The controller is the sole contract, task-state, session-event, integration, and\nverdict writer/);
  assert.match(skill, /Read \[orchestration\.md\]\(references\/orchestration\.md\) before delegating a worker/);
  assert.match(skill, /`begin` derives a conservative structured execution plan/);
  assert.match(skill, /Every writable Worker, including a\nsingle Worker, uses its own isolated worktree/);
  assert.match(skill, /stop manually running manifest-owned `module`, `broad`, or UAT commands/);
  assert.match(governance, /A pre-dispatch\n`model_identity` or `permission` failure is permanent/);
  assert.match(orchestration, /The frozen shared-interface contract is required\nonly when a batch actually runs two or more Workers concurrently/);
  assert.match(governance, /The core remains host-agnostic and does not call\nCodex proprietary APIs directly/);
  assert.match(verification, /worker lifecycle of `completed` alone is not evidence/);
  assert.match(readme, /ordinary `git\nworktree remove` must succeed without `--force`/);
});

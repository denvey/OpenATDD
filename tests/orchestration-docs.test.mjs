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
  const [skill, governance, verification, readme] = await Promise.all([
    read("skills/openatdd/SKILL.md"),
    read("skills/openatdd/references/governance.md"),
    read("skills/openatdd/references/verification-routing.md"),
    read("README.md"),
  ]);
  const docs = [skill, governance, verification, readme].join("\n");

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

  assert.match(skill, /The controller is the sole contract, task-state, session-event, integration, and\nverdict writer/);
  assert.match(governance, /The core remains host-agnostic and does not call\nCodex proprietary APIs directly/);
  assert.match(verification, /worker lifecycle of `completed` alone is not evidence/);
  assert.match(readme, /ordinary `git\nworktree remove` must succeed without `--force`/);
});

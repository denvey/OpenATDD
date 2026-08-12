import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillPath = path.resolve("skills", "openatdd-code-review", "SKILL.md");
const metadataPath = path.resolve("skills", "openatdd-code-review", "agents", "openai.yaml");

test("OpenATDD Code Review stays bounded and routes review without copying delivery machinery", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert(Buffer.byteLength(skill) <= 4096);
  assert.match(skill, /name: openatdd-code-review/);
  assert.match(skill, /Use when asked to review code, a PR, branch, diff, or current changes/);
  assert.match(skill, /read-only intent, not a fourth Quick\/Standard\/Deep lane/);
  assert.match(skill, /OpenATDD task's approved `acceptance\.md` and `solution\.md`/);
  assert.match(skill, /PR, issue, design document, or user description/);
  assert.match(skill, /skip spec-conformance conclusions.*never fabricate requirements/s);
  assert.doesNotMatch(skill, /approve-acceptance|approve-solution|finalize --fast|Gate 1/);
});

test("review findings require severity, tight evidence, and an honest no-finding result", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /\*\*Spec:\*\*/);
  assert.match(skill, /\*\*Correctness:\*\*/);
  for (const label of ["P0", "P1", "P2", "P3"]) assert.match(skill, new RegExp(`\\b${label}\\b`));
  for (const field of ["Trigger:", "Impact:", "Evidence:", "Direction:"]) assert.match(skill, new RegExp(field));
  assert.match(skill, /tight changed or directly affected `file:line` location/);
  assert.match(skill, /Do not turn uncertainty into a defect/);
  assert.match(skill, /No blocking findings\./);
  assert.match(skill, /Never manufacture comments/);
});

test("review is non-mutating and hands explicitly requested fixes back to OpenATDD", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /Do not run formatters, fix modes,\s*dependency installation, generators/s);
  assert.match(skill, /Review alone never modifies files, commits, OpenATDD state, PR comments/);
  assert.match(skill, /If the user explicitly requests fixes, finish\s*the review first/s);
  assert.match(skill, /issue\/repair flow/);
  assert.match(skill, /invoke `\$openatdd` for a new bug-fix task/);
  assert.match(skill, /independent read-only pass only for large\/high-risk changes or on request/);
});

test("the Skill metadata, package, and installation docs expose the companion Skill", async () => {
  const [metadata, packageSource, readme] = await Promise.all([
    readFile(metadataPath, "utf8"),
    readFile(path.resolve("package.json"), "utf8"),
    readFile(path.resolve("README.md"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.match(metadata, /display_name: "OpenATDD Code Review"/);
  assert.match(metadata, /default_prompt: "Use \$openatdd-code-review/);
  assert(packageJson.files.includes("skills/openatdd-code-review"));
  assert.match(readme, /skills\/openatdd-code-review/);
  assert.match(readme, /\$openatdd-code-review Review the current changes/);
  assert.match(readme, /read-only companion/);
});

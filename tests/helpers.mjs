import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  approveAcceptance,
  approveSolution,
  createTask,
  draftSolution,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";

export function clock(value) {
  return () => new Date(value);
}

export async function temporaryProject(testContext) {
  const root = await mkdtemp(path.join(tmpdir(), "openatdd-test-"));
  testContext?.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export function criterion(id, overrides = {}) {
  return {
    id,
    classification: "AUTO",
    blocking: true,
    title: `Observable outcome for ${id}`,
    given: "A representative project and authorized user exist",
    when: "The approved user action is performed",
    then: "The expected observable result occurs",
    evidence: "A deterministic result is captured",
    ...overrides,
  };
}

export function acceptanceMarkdown(taskId, criteria = [criterion("AC-01")]) {
  const blocks = criteria.map((item) => `### ${item.id} [${item.classification}] [${item.blocking ? "BLOCKING" : "NON_BLOCKING"}] ${item.title}
- Given: ${item.given}
- When: ${item.when}
- Then: ${item.then}
- Evidence: ${item.evidence}`).join("\n\n");
  return `# Acceptance card: ${taskId}

## Goal

Deliver an observable user outcome safely.

## Suggested user journey

1. Start from a representative state.
2. Perform the user action.
3. Observe and verify the result.

## Criteria

${blocks}

## Boundaries

- Use local deterministic fixtures and do not contact production.
`;
}

export function solutionMarkdown(taskId, criteria = [criterion("AC-01")], impactPaths = ["src/feature"]) {
  const rows = criteria.map((item) => `| ${item.id} | Implement ${item.title.toLowerCase()} | Execute deterministic verification |`).join("\n");
  return `# Solution card: ${taskId}

## Implementation

- Reuse the project architecture and add the smallest complete behavior.

## Impact paths

${impactPaths.map((item) => `- \`${item}\``).join("\n")}

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
${rows}

## Risks

- Guard contract order and retain fresh evidence.

## Deliberate exclusions

- Do not deploy or notify external systems.
`;
}

export async function writeAcceptance(root, taskId, criteria) {
  const files = taskFiles(root, taskId);
  await writeFile(files.acceptance, acceptanceMarkdown(taskId, criteria));
  return files;
}

export async function writeSolution(root, taskId, criteria, impactPaths) {
  const files = taskFiles(root, taskId);
  await writeFile(files.solution, solutionMarkdown(taskId, criteria, impactPaths));
  return files;
}

export async function prepareApprovedTask(root, taskId, options = {}) {
  const criteria = options.criteria ?? [criterion("AC-01")];
  const createdAt = options.createdAt ?? "2020-01-01T00:00:00.000Z";
  const acceptanceAt = options.acceptanceAt ?? "2020-01-01T00:01:00.000Z";
  const solutionAt = options.solutionAt ?? "2020-01-01T00:02:00.000Z";
  await createTask(root, taskId, options.requirement ?? `Deliver ${taskId}`, clock(createdAt));
  await writeAcceptance(root, taskId, criteria);
  await approveAcceptance(root, taskId, clock(acceptanceAt));
  await draftSolution(root, taskId, clock(acceptanceAt));
  await writeSolution(root, taskId, criteria, options.impactPaths ?? ["src/feature"]);
  const approved = await approveSolution(root, taskId, clock(solutionAt));
  return { ...approved, criteria };
}

export async function writeEvidence(root, taskId, name, content = name) {
  const files = taskFiles(root, taskId);
  await mkdir(files.evidence, { recursive: true });
  const target = path.join(files.evidence, name);
  await writeFile(target, `${content}\n`);
  return path.relative(root, target);
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGraph,
  findImpactRelationships,
  graphFiles,
  graphStaleness,
  loadGraph,
  queryGraph,
  validateGraph,
} from "../skills/openatdd/scripts/graph.mjs";
import {
  buildScopedContext,
  checkContextStaleness,
  contextFiles,
  loadScopedContext,
  validateScopedContext,
} from "../skills/openatdd/scripts/context.mjs";
import { gitPrivateRoot } from "../skills/openatdd/scripts/lib.mjs";
import { requirementDocument, replaceRequirementSection } from "../skills/openatdd/scripts/contracts.mjs";

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "openatdd-knowledge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function criterion(id, title) {
  return {
    id,
    classification: "AUTO",
    blocking: true,
    title,
    given: "A representative project exists",
    when: "The approved user action runs",
    then: "The observable result is correct",
    evidence: "A deterministic result is captured",
  };
}

function acceptance(taskId, item) {
  return `# Acceptance card: ${taskId}

## Goal

${item.title}

## Suggested user journey

1. Start from a representative state.
2. Perform the approved action.
3. Observe the result.

## Criteria

### ${item.id} [AUTO] [BLOCKING] ${item.title}
- Given: ${item.given}
- When: ${item.when}
- Then: ${item.then}
- Evidence: ${item.evidence}

## Boundaries

- Keep the change local and deterministic.
`;
}

function solution(taskId, item, impactPath) {
  return `# Solution card: ${taskId}

## Implementation

- Reuse the existing export path and preserve pagination.

## Impact paths

- \`${impactPath}\`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| ${item.id} | Reuse export flow | Verify every page |

## Risks

- Pagination must not omit the final cursor.

## Deliberate exclusions

- Do not add external services.
`;
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTask(root, taskId, requirement, item, impactPath, approvedAt, extra = {}) {
  const directory = path.join(gitPrivateRoot(root), "tasks", taskId);
  await mkdir(directory, { recursive: true });
  const requirementPath = path.join(root, ".openatdd", "requirements", `${taskId}.md`);
  await mkdir(path.dirname(requirementPath), { recursive: true });
  let document = requirementDocument(taskId, requirement);
  document = replaceRequirementSection(document, "acceptance", acceptance(taskId, item));
  document = replaceRequirementSection(document, "solution", solution(taskId, item, impactPath));
  await writeFile(requirementPath, document);
  await writeJson(path.join(directory, "state.json"), {
    schemaVersion: 3,
    taskId,
    requirement,
    phase: "IMPLEMENTING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: approvedAt,
    acceptance: { approvedAt: "2026-01-01T00:01:00.000Z", items: [item] },
    solution: {
      approvedAt,
      impactPaths: [impactPath],
      trace: [{ acceptanceId: item.id, implementation: "Reuse export", verification: "Verify every page" }],
    },
    results: {},
    checks: {},
    issues: [],
    affectedDependencies: [],
    ...extra,
  });
}

async function projectFixture(t) {
  const root = await temporaryProject(t);
  const older = criterion("AC-01", "Every matching order is exported exactly once");
  const current = criterion("AC-01", "Filtered orders can be exported safely");
  const invariantRelated = criterion("AC-01", "A separate filter preserves the pagination invariant");
  await writeTask(root, "older-export", "Export all paginated orders", older, "src/export", "2026-01-02T00:00:00.000Z");
  await writeTask(root, "current-export", "Add filtered order export", current, "src/export/csv", "2026-01-03T00:00:00.000Z", {
    routing: { lane: "standard" },
    decisions: [{
      id: "DEC-001",
      status: "resolved",
      question: "Which rows are exported?",
      recommendation: "All filtered rows",
      resolution: "All filtered rows",
    }],
  });
  await writeTask(root, "invariant-export", "Filter a separate reporting source", invariantRelated, "src/report-filter", "2026-01-04T00:00:00.000Z");

  const memory = path.join(gitPrivateRoot(root), "memory");
  await mkdir(path.join(memory, "incidents"), { recursive: true });
  await writeFile(path.join(memory, "incidents", "INC-2026-001-pagination.md"), "# Pagination incident\n\nThe final cursor was omitted.\n");
  await writeFile(path.join(memory, "incidents", "INC-2026-002-filter.md"), "# Filter incident\n\nA reporting filter bypassed the shared pagination invariant.\n");
  await mkdir(path.join(root, ".openatdd", "knowledge"), { recursive: true });
  await writeFile(path.join(root, ".openatdd", "knowledge", "invariants.md"), `# Project invariants

## INV-2026-001

Every matching pagination cursor is consumed exactly once.
`);
  await writeJson(path.join(memory, "index.json"), {
    schemaVersion: 1,
    incidents: [{
      id: "INC-2026-001",
      title: "Final pagination cursor omitted",
      rootCause: "The loop stopped before consuming the final cursor",
      invariantId: "INV-2026-001",
      invariant: "Every matching pagination cursor is consumed exactly once",
      tests: ["export_includes_final_page"],
      paths: ["src/export"],
      tags: ["pagination", "export"],
      sourceTask: "older-export",
      sourceIssue: "ISSUE-001",
      createdAt: "2026-01-02T01:00:00.000Z",
      file: "incidents/INC-2026-001-pagination.md",
    }, {
      id: "INC-2026-002",
      title: "Reporting filter bypassed pagination",
      rootCause: "The filter used a separate cursor loop",
      invariantId: "INV-2026-002",
      invariant: "Every matching pagination cursor is consumed exactly once",
      tests: ["report_filter_consumes_final_page"],
      paths: ["src/report-filter"],
      tags: ["pagination", "filter"],
      sourceTask: "invariant-export",
      sourceIssue: "ISSUE-001",
      createdAt: "2026-01-04T01:00:00.000Z",
      file: "incidents/INC-2026-002-filter.md",
    }],
  });
  const knowledge = path.join(root, ".openatdd", "knowledge");
  await mkdir(path.join(knowledge, "standards"), { recursive: true });
  await mkdir(path.join(knowledge, "research"), { recursive: true });
  await writeFile(path.join(knowledge, "project.md"), `# Project truth

## Product rules

- Every export preserves the selected filters.

## Architecture boundaries

- Export orchestration stays in src/export.

## Technical decisions

- Pagination reuses the established cursor loop.
`);
  await writeFile(path.join(knowledge, "standards", "export.md"), "# Export standard\n\nEvery export consumes deterministic pagination and reuses established paths.\n");
  await writeFile(path.join(knowledge, "research", "filtered-export.md"), "# Filtered export research\n\nLocal analysis favors the existing cursor implementation over new infrastructure.\n");
  await writeJson(path.join(gitPrivateRoot(root), "environments", "observations.json"), {
    schemaVersion: 1,
    observations: [{
      environment: "local",
      key: "application_version",
      value: "1.0.0",
      source: "package metadata",
      last_verified_at: "2026-01-03T00:00:00.000Z",
      evidence: [],
    }],
    stale: [],
  });
  return { root, older, current };
}

test("rebuilds a typed graph with stable provenance and token query", async (t) => {
  const { root } = await projectFixture(t);
  const graph = await buildGraph(root, { persist: true, clock: () => new Date("2026-01-04T00:00:00.000Z") });

  assert.equal(validateGraph(graph).valid, true);
  assert(await readFile(graphFiles(root).graph, "utf8"));
  assert(graph.nodes.some((node) => node.id === "task:current-export" && node.type === "Task"));
  assert(graph.nodes.some((node) => node.id === "invariant:INV-2026-001" && node.type === "Invariant"));
  assert(graph.nodes.some((node) => node.id === "project-truth:current" && node.type === "ProjectTruth"));
  assert(graph.nodes.some((node) => node.type === "Standard" && node.source.path.endsWith("standards/export.md")));
  assert(graph.nodes.some((node) => node.type === "Research" && node.source.path.endsWith("research/filtered-export.md")));
  assert(graph.nodes.some((node) => node.type === "EnvironmentObservation"));
  assert(graph.edges.some((edge) => edge.type === "implements"));
  assert(graph.nodes.every((node) => node.source.path && node.source.sha256 && node.provenance.canonical));
  assert(graph.edges.every((edge) => edge.source.path && edge.source.sha256 && edge.provenance.canonical));

  const query = queryGraph(graph, "pagination final cursor");
  assert(query.matches.some((match) => match.node.id === "incident:INC-2026-001"));
  assert(query.matches.some((match) => match.node.id === "invariant:INV-2026-001"));
  assert(queryGraph(graph, "existing cursor infrastructure").matches.some((match) => match.node.type === "Research"));
});

test("combines semantic relations with conservative impact-path fallback", async (t) => {
  const { root } = await projectFixture(t);
  const graph = await buildGraph(root);
  const impacts = findImpactRelationships(graph, { taskId: "current-export" });

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].taskId, "older-export");
  assert.deepEqual(impacts[0].acceptanceIds, ["AC-01"]);
  assert(impacts[0].reasons.some((reason) => reason.startsWith("path-overlap:src/export/csv:src/export")));
  assert(impacts[0].edges.length > 0);
});

test("derives shared-invariant impacts even when implementation paths do not overlap", async (t) => {
  const { root } = await projectFixture(t);
  const graph = await buildGraph(root);
  const impacts = findImpactRelationships(graph, { taskId: "invariant-export", impactPaths: ["src/report-filter"] });

  assert(impacts.some((impact) => impact.taskId === "older-export"));
  const older = impacts.find((impact) => impact.taskId === "older-export");
  assert(older.reasons.includes("semantic-shares-invariant-with"));
  assert(!older.reasons.some((reason) => reason.startsWith("path-overlap:")));
  assert(graph.edges.some((edge) => edge.type === "shares-invariant-with" && edge.provenance.kind === "derived-shared-invariant"));
});

test("detects changed canonical sources and repairs stale, missing, or invalid indexes", async (t) => {
  const { root, current } = await projectFixture(t);
  const first = await buildGraph(root, { persist: true });
  const acceptancePath = path.join(root, ".openatdd", "requirements", "current-export.md");
  const document = await readFile(acceptancePath, "utf8");
  await writeFile(acceptancePath, replaceRequirementSection(document, "acceptance", acceptance("current-export", { ...current, title: "Filtered orders export with a visible status" })));

  const stale = await graphStaleness(root, first);
  assert.equal(stale.stale, true);
  const rebuilt = await loadGraph(root);
  assert.equal(rebuilt.loadStatus.rebuilt, true);
  assert(queryGraph(rebuilt, "visible status").matches.some((match) => match.node.id === "acceptance:current-export:AC-01"));

  await rm(graphFiles(root).graph);
  const missing = await loadGraph(root);
  assert.equal(missing.loadStatus.rebuilt, true);
  assert.equal(await readFile(graphFiles(root).graph, "utf8").then(Boolean), true);

  await writeFile(graphFiles(root).graph, "{invalid json\n");
  const repaired = await loadGraph(root);
  assert.equal(repaired.loadStatus.rebuilt, true);
  assert.equal(validateGraph(repaired).valid, true);
});

test("builds one scoped context with distinct implementation and verification references", async (t) => {
  const { root } = await projectFixture(t);
  const files = contextFiles(root, "current-export");
  const quick = await buildScopedContext(root, "current-export", {
    lane: "quick",
    persistGraph: false,
    clock: () => new Date("2026-01-04T00:00:00.000Z"),
  });

  assert.equal(validateScopedContext(quick).valid, true);
  assert.equal(quick.lane, "quick");
  assert.equal(await readFile(files.state, "utf8").then(Boolean), true);
  await assert.rejects(() => readFile(files.context, "utf8"), (error) => error.code === "ENOENT");
  assert(quick.implementation.some((reference) => reference.type === "SolutionContract"));
  assert(quick.implementation.some((reference) => reference.type === "ProjectTruth"));
  assert(quick.verification.some((reference) => reference.type === "ProjectTruth"));
  assert(quick.verification.some((reference) => reference.type === "HistoricalAcceptance"));
  assert(!quick.implementation.some((reference) => reference.type === "HistoricalAcceptance"));
  assert(Object.keys(quick.sourceDigests).every((source) => /^(?:project|git):/.test(source)));

  const standard = await buildScopedContext(root, "current-export", { lane: "standard", persist: true });
  assert.equal(JSON.parse(await readFile(files.context, "utf8")).digest, standard.digest);
  assert(standard.implementation.some((reference) => reference.type === "Decision"));
  assert(standard.implementation.some((reference) => reference.type === "ProjectTruth"));
  assert(standard.implementation.some((reference) => reference.type === "Standard"));
  assert(standard.verification.some((reference) => reference.type === "EnvironmentObservation"));
  const deep = await buildScopedContext(root, "current-export", { lane: "deep", persist: false });
  assert(deep.implementation.some((reference) => reference.type === "ProjectTruth"));
  assert(deep.verification.some((reference) => reference.type === "ProjectTruth"));
  assert(deep.implementation.some((reference) => reference.type === "Research"));
});

test("project truth changes stale and rebuild the derived graph and task context", async (t) => {
  const { root } = await projectFixture(t);
  const storedGraph = await buildGraph(root, { persist: true });
  const storedContext = await buildScopedContext(root, "current-export", { lane: "standard", persist: true });
  const projectTruth = path.join(root, ".openatdd", "knowledge", "project.md");
  await writeFile(projectTruth, `# Project truth

## Product rules

- Every export preserves filters and the current sort order.

## Architecture boundaries

- Export orchestration stays in src/export.

## Technical decisions

- Pagination reuses the established cursor loop.
`);

  const graphStatus = await graphStaleness(root, storedGraph);
  assert.equal(graphStatus.stale, true);
  const contextStatus = await checkContextStaleness(root, storedContext, { checkGraph: false });
  assert.equal(contextStatus.stale, true);
  assert(contextStatus.reasons.some((reason) => reason.includes(".openatdd/knowledge/project.md")));

  const rebuiltGraph = await loadGraph(root);
  assert.match(rebuiltGraph.nodes.find((node) => node.type === "ProjectTruth").text, /current sort order/);
  const rebuiltContext = await loadScopedContext(root, "current-export", { lane: "standard", persist: false });
  assert.equal(rebuiltContext.loadStatus.rebuilt, true);
  assert(rebuiltContext.implementation.some((reference) => (
    reference.type === "ProjectTruth" && reference.digest === rebuiltGraph.nodes.find((node) => node.type === "ProjectTruth").source.sha256
  )));
});

test("marks changed scoped sources stale and safely rebuilds missing context", async (t) => {
  const { root } = await projectFixture(t);
  const context = await buildScopedContext(root, "current-export", { lane: "standard", persist: true });
  const solutionPath = contextFiles(root, "current-export").solution;
  const document = await readFile(solutionPath, "utf8");
  await writeFile(solutionPath, replaceRequirementSection(document, "solution", `${solution("current-export", criterion("AC-01", "Filtered orders can be exported safely"), "src/export/csv")}\n<!-- clarified -->\n`));

  const stale = await checkContextStaleness(root, context, { checkGraph: false });
  assert.equal(stale.stale, true);
  assert(stale.reasons.some((reason) => reason.includes("current-export.md")));

  await rm(contextFiles(root, "current-export").context);
  const rebuilt = await loadScopedContext(root, "current-export", { lane: "standard", persist: false });
  assert.equal(rebuilt.loadStatus.rebuilt, true);
  assert.equal(validateScopedContext(rebuilt).valid, true);
  await assert.rejects(() => readFile(contextFiles(root, "current-export").context, "utf8"), (error) => error.code === "ENOENT");
});

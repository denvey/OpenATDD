import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  atomicWrite,
  normalizeImpactPath,
  pathExists,
  sha256,
  toPosix,
  tokenize,
} from "./lib.mjs";
import { parseAcceptance, parseSolution } from "./contracts.mjs";

const GRAPH_SCHEMA_VERSION = 1;
const RELATION_TYPES = new Set([
  "affects",
  "derived-from",
  "establishes",
  "has-acceptance",
  "has-check",
  "has-issue",
  "has-solution",
  "implements",
  "requires",
  "shares-invariant-with",
  "supported-by",
  "supersedes",
  "touches-path",
  "validates",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, item]) => [key, stableValue(item)],
    ));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function graphContentDigest(graph) {
  return sha256(stableJson({
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes,
    edges: graph.edges,
    sources: graph.sources,
  }));
}

function nowIso(clock) {
  return clock().toISOString();
}

function relativePath(root, target) {
  return toPosix(path.relative(path.resolve(root), path.resolve(target)));
}

function safeIdPart(value) {
  return encodeURIComponent(String(value ?? "unknown").trim().toLowerCase());
}

function provenance(kind, fields = []) {
  return { kind, canonical: true, fields };
}

function emptyGraph(clock = () => new Date(), warnings = []) {
  const graph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    kind: "openatdd-semantic-index",
    builtAt: nowIso(clock),
    stale: false,
    sources: [],
    nodes: [],
    edges: [],
    warnings: [...warnings],
  };
  graph.contentDigest = graphContentDigest(graph);
  return graph;
}

function withLoadStatus(graph, status) {
  Object.defineProperty(graph, "loadStatus", { value: status, enumerable: false, configurable: true });
  return graph;
}

export function graphFiles(root) {
  const projectRoot = path.resolve(root);
  const openatdd = path.join(projectRoot, ".openatdd");
  const knowledge = path.join(openatdd, "knowledge");
  return {
    root: projectRoot,
    openatdd,
    tasks: path.join(openatdd, "tasks"),
    memory: path.join(openatdd, "memory"),
    memoryIndex: path.join(openatdd, "memory", "index.json"),
    invariants: path.join(openatdd, "memory", "invariants.md"),
    observations: path.join(openatdd, "environments", "observations.json"),
    projectTruth: path.join(knowledge, "project.md"),
    standards: path.join(knowledge, "standards"),
    research: path.join(knowledge, "research"),
    knowledge,
    graph: path.join(knowledge, "graph.json"),
  };
}

async function sourceFile(root, target, warnings, label = "source") {
  const relative = relativePath(root, target);
  try {
    const bytes = await readFile(target);
    return {
      source: { path: relative, sha256: sha256(bytes), size: bytes.byteLength },
      bytes,
      text: bytes.toString("utf8"),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") warnings.push(`Could not read ${label} ${relative}: ${error.message}`);
    return null;
  }
}

function parseJsonSource(file, warnings) {
  if (!file) return null;
  try {
    return JSON.parse(file.text);
  } catch (error) {
    warnings.push(`Ignored invalid JSON in ${file.source.path}: ${error.message}`);
    return null;
  }
}

function acceptanceItems(state, markdown) {
  const parsed = markdown ? parseAcceptance(markdown).criteria : [];
  return parsed.length ? parsed : (state?.acceptance?.items ?? []);
}

function solutionData(state, markdown) {
  const parsed = markdown ? parseSolution(markdown) : { implementation: "", impactPaths: [], trace: [] };
  return {
    implementation: parsed.implementation,
    impactPaths: parsed.impactPaths.length ? parsed.impactPaths : (state?.solution?.impactPaths ?? []),
    trace: parsed.trace.length ? parsed.trace : (state?.solution?.trace ?? []),
  };
}

function decisionItems(state) {
  const decisions = state?.decisions;
  if (!decisions) return [];
  if (Array.isArray(decisions)) return decisions;
  const values = [];
  for (const [status, collection] of Object.entries(decisions)) {
    if (Array.isArray(collection)) values.push(...collection.map((item) => ({ status, ...item })));
    else if (collection && typeof collection === "object") {
      values.push(...Object.entries(collection).map(([id, item]) => ({ id, status, ...item })));
    }
  }
  return values;
}

function invariantSections(markdown) {
  const matches = [...String(markdown ?? "").matchAll(/^##\s+([^\n]+)\s*$/gm)];
  return matches.map((match, index) => {
    const heading = match[1].trim();
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd).trim();
    const idMatch = /\b(INV-[A-Za-z0-9-]+)\b/.exec(heading);
    return { id: idMatch?.[1] ?? `INV-${sha256(`${heading}\n${body}`).slice(0, 12)}`, title: heading, body };
  }).filter((item) => item.body);
}

function evidenceItems(value) {
  return Array.isArray(value) ? value.filter((item) => item?.path || item?.sha256) : [];
}

async function taskDirectoryNames(directory, warnings) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") warnings.push(`Could not enumerate tasks: ${error.message}`);
    return [];
  }
}

async function knowledgeDocumentPaths(directory, warnings, label) {
  const discovered = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") warnings.push(`Could not enumerate ${label}: ${error.message}`);
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.(?:md|txt|json|ya?ml)$/i.test(entry.name)) discovered.push(target);
    }
  }
  await visit(directory);
  return discovered;
}

function documentTitle(file, fallback) {
  return /^#\s+(.+)$/m.exec(file.text)?.[1]?.trim() || fallback;
}

async function addKnowledgeDocuments(builder, root, directory, type, sources, warnings) {
  for (const target of await knowledgeDocumentPaths(directory, warnings, type.toLowerCase())) {
    const file = await sourceFile(root, target, warnings, type.toLowerCase());
    if (!file) continue;
    sources.set(file.source.path, file.source);
    const relative = relativePath(directory, target);
    builder.addNode({
      id: `${type.toLowerCase()}:${safeIdPart(relative)}`,
      type,
      title: documentTitle(file, path.basename(target)),
      text: file.text.trim().slice(0, 12_000),
      path: file.source.path,
      source: file.source,
      provenance: provenance(`${type.toLowerCase()}-document`, [relative]),
    });
  }
}

async function addProjectTruth(builder, root, target, sources, warnings) {
  const file = await sourceFile(root, target, warnings, "project truth");
  if (!file) return;
  sources.set(file.source.path, file.source);
  builder.addNode({
    id: "project-truth:current",
    type: "ProjectTruth",
    title: documentTitle(file, "Project truth"),
    text: file.text.trim().slice(0, 8_000),
    path: file.source.path,
    source: file.source,
    provenance: provenance("project-truth", ["product-rules", "architecture-boundaries", "technical-decisions"]),
  });
}

function addSearchTokens(node) {
  const searchable = [
    node.id,
    node.type,
    node.title,
    node.text,
    node.taskId,
    node.acceptanceId,
    node.path,
    ...(node.tags ?? []),
  ].filter(Boolean).join(" ");
  return { ...node, tokens: tokenize(searchable) };
}

function makeBuilder() {
  const nodes = new Map();
  const edges = new Map();
  return {
    addNode(input) {
      const node = addSearchTokens(input);
      const prior = nodes.get(node.id);
      nodes.set(node.id, prior ? addSearchTokens({ ...prior, ...node }) : node);
      return node.id;
    },
    addEdge(from, type, to, input = {}) {
      if (!from || !to) return null;
      const id = `edge:${sha256(`${from}\u0000${type}\u0000${to}`).slice(0, 24)}`;
      edges.set(id, { id, from, type, to, ...input });
      return id;
    },
    finish() {
      const known = new Set(nodes.keys());
      const validEdges = [...edges.values()].filter((edge) => known.has(edge.from) && known.has(edge.to));
      return {
        nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
        edges: validEdges.sort((left, right) => left.id.localeCompare(right.id)),
      };
    },
  };
}

function recordedEvidenceNode(builder, root, taskId, ownerId, item, source, relation, warnings) {
  const recordedDigest = item.sha256 ?? sha256(stableJson(item));
  const id = `evidence:${recordedDigest}`;
  const target = item.path ? path.resolve(root, item.path) : null;
  const withinRoot = target && (relativePath(root, target) === "" || !relativePath(root, target).startsWith("../"));
  builder.addNode({
    id,
    type: "Evidence",
    title: item.path ?? `Recorded evidence ${recordedDigest.slice(0, 12)}`,
    taskId,
    path: item.path,
    recordedDigest,
    stale: false,
    source: withinRoot ? { path: relativePath(root, target), sha256: recordedDigest } : source,
    provenance: provenance("recorded-evidence", ["state.json"]),
  });
  builder.addEdge(ownerId, relation, id, { source, provenance: provenance("state-reference", ["evidence"]) });
  if (item.path && !withinRoot) warnings.push(`Ignored evidence path outside project: ${item.path}`);
}

function pathNode(builder, value, source, ownerId) {
  const normalized = normalizeImpactPath(String(value ?? ""));
  if (!normalized) return null;
  const id = `path:${safeIdPart(normalized)}`;
  builder.addNode({
    id,
    type: "CodePath",
    title: normalized,
    path: normalized,
    source,
    provenance: provenance("contract-impact-path", ["solution.impactPaths"]),
  });
  builder.addEdge(ownerId, "touches-path", id, { source, provenance: provenance("contract-impact-path", ["solution.impactPaths"]) });
  return id;
}

function explicitRelations(state) {
  const values = state?.relationships ?? state?.relations ?? [];
  return Array.isArray(values) ? values : [];
}

async function addTask(builder, root, taskId, sources, warnings, deferredEdges) {
  const directory = path.join(root, ".openatdd", "tasks", taskId);
  const [stateFile, acceptanceFile, solutionFile] = await Promise.all([
    sourceFile(root, path.join(directory, "state.json"), warnings, "task state"),
    sourceFile(root, path.join(directory, "acceptance.md"), warnings, "acceptance card"),
    sourceFile(root, path.join(directory, "solution.md"), warnings, "solution card"),
  ]);
  for (const file of [stateFile, acceptanceFile, solutionFile]) if (file) sources.set(file.source.path, file.source);
  const state = parseJsonSource(stateFile, warnings) ?? {};
  const taskSource = stateFile?.source ?? acceptanceFile?.source ?? solutionFile?.source;
  if (!taskSource) return;

  const taskNode = `task:${taskId}`;
  builder.addNode({
    id: taskNode,
    type: "Task",
    title: state.requirement || taskId,
    text: state.requirement || "",
    taskId,
    phase: state.phase,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    source: taskSource,
    provenance: provenance("task-state", ["requirement", "phase"]),
  });

  const criteria = acceptanceItems(state, acceptanceFile?.text);
  for (const criterion of criteria) {
    const id = `acceptance:${taskId}:${criterion.id}`;
    builder.addNode({
      id,
      type: "Acceptance",
      title: criterion.title || criterion.id,
      text: [criterion.given, criterion.when, criterion.then, criterion.evidence].filter(Boolean).join(" "),
      taskId,
      acceptanceId: criterion.id,
      classification: criterion.classification,
      blocking: criterion.blocking,
      source: acceptanceFile?.source ?? taskSource,
      provenance: provenance("acceptance-contract", [criterion.id]),
    });
    builder.addEdge(taskNode, "has-acceptance", id, {
      source: acceptanceFile?.source ?? taskSource,
      provenance: provenance("acceptance-contract", [criterion.id]),
    });
    const result = state.results?.[criterion.id];
    for (const evidence of evidenceItems(result?.evidence)) {
      recordedEvidenceNode(builder, root, taskId, id, evidence, stateFile?.source ?? taskSource, "validated-by", warnings);
    }
  }

  const solution = solutionData(state, solutionFile?.text);
  if (solutionFile || state.solution?.approvedAt || solution.impactPaths.length > 0) {
    const solutionNode = `solution:${taskId}`;
    builder.addNode({
      id: solutionNode,
      type: "Solution",
      title: `Solution for ${state.requirement || taskId}`,
      text: solution.implementation,
      taskId,
      approvedAt: state.solution?.approvedAt,
      source: solutionFile?.source ?? taskSource,
      provenance: provenance("solution-contract", ["implementation", "impactPaths", "trace"]),
    });
    builder.addEdge(taskNode, "has-solution", solutionNode, {
      source: solutionFile?.source ?? taskSource,
      provenance: provenance("solution-contract", ["solution"]),
    });
    for (const impactPath of solution.impactPaths ?? []) pathNode(builder, impactPath, solutionFile?.source ?? taskSource, solutionNode);
    for (const row of solution.trace ?? []) {
      builder.addEdge(solutionNode, "implements", `acceptance:${taskId}:${row.acceptanceId}`, {
        source: solutionFile?.source ?? taskSource,
        text: [row.implementation, row.verification].filter(Boolean).join(" "),
        provenance: provenance("acceptance-trace", [row.acceptanceId]),
      });
    }
  }

  for (const decision of decisionItems(state)) {
    const decisionId = decision.id ?? `DEC-${sha256(stableJson(decision)).slice(0, 12)}`;
    const id = `decision:${taskId}:${decisionId}`;
    builder.addNode({
      id,
      type: "Decision",
      title: decision.question ?? decision.title ?? decisionId,
      text: [decision.recommendation, decision.resolution, decision.reason, decision.basis].filter(Boolean).join(" "),
      taskId,
      status: decision.status,
      source: stateFile?.source ?? taskSource,
      provenance: provenance("task-decision", [decisionId]),
    });
    builder.addEdge(taskNode, "requires", id, { source: stateFile?.source ?? taskSource, provenance: provenance("task-decision", [decisionId]) });
  }

  for (const issue of state.issues ?? []) {
    const id = `issue:${taskId}:${issue.id}`;
    builder.addNode({
      id,
      type: "Issue",
      title: issue.symptom || issue.id,
      text: [issue.rootCause, issue.invariant, ...(issue.regression ?? [])].filter(Boolean).join(" "),
      taskId,
      acceptanceId: issue.acceptanceId,
      status: issue.status,
      source: stateFile?.source ?? taskSource,
      provenance: provenance("task-issue", [issue.id]),
    });
    builder.addEdge(taskNode, "has-issue", id, { source: stateFile?.source ?? taskSource, provenance: provenance("task-issue", [issue.id]) });
    builder.addEdge(id, "affects", `acceptance:${taskId}:${issue.acceptanceId}`, {
      source: stateFile?.source ?? taskSource,
      provenance: provenance("task-issue", [issue.id, "acceptanceId"]),
    });
    if (issue.memoryId) deferredEdges.push({
      from: id,
      type: "derived-from",
      to: `incident:${issue.memoryId}`,
      source: stateFile?.source ?? taskSource,
      provenance: provenance("task-issue", [issue.id, "memoryId"]),
    });
    for (const impactPath of issue.paths ?? []) pathNode(builder, impactPath, stateFile?.source ?? taskSource, id);
    for (const evidence of evidenceItems(issue.evidence)) {
      recordedEvidenceNode(builder, root, taskId, id, evidence, stateFile?.source ?? taskSource, "supported-by", warnings);
    }
  }

  for (const [key, check] of Object.entries(state.checks ?? {})) {
    const id = `check:${taskId}:${safeIdPart(check.id ?? key)}`;
    builder.addNode({
      id,
      type: "Check",
      title: check.name ?? key,
      text: [check.command, check.summary].filter(Boolean).join(" "),
      taskId,
      status: check.status,
      source: stateFile?.source ?? taskSource,
      provenance: provenance("task-check", [key]),
    });
    builder.addEdge(taskNode, "has-check", id, { source: stateFile?.source ?? taskSource, provenance: provenance("task-check", [key]) });
    for (const evidence of evidenceItems(check.evidence)) {
      recordedEvidenceNode(builder, root, taskId, id, evidence, stateFile?.source ?? taskSource, "supported-by", warnings);
    }
  }

  for (const dependency of state.affectedDependencies ?? []) {
    for (const acceptanceId of dependency.acceptanceIds ?? []) {
      deferredEdges.push({
        from: taskNode,
        type: "affects",
        to: `acceptance:${dependency.taskId}:${acceptanceId}`,
        source: stateFile?.source ?? taskSource,
        provenance: provenance("affected-dependency", [dependency.taskId, acceptanceId]),
      });
    }
  }
  for (const relation of explicitRelations(state)) {
    if (!relation?.from || !relation?.to || !RELATION_TYPES.has(relation.type)) continue;
    deferredEdges.push({
      from: relation.from,
      type: relation.type,
      to: relation.to,
      source: stateFile?.source ?? taskSource,
      provenance: provenance("explicit-task-relation", [relation.type]),
    });
  }
}

async function addMemory(builder, root, files, sources, warnings, deferredEdges) {
  const [indexFile, invariantFile] = await Promise.all([
    sourceFile(root, files.memoryIndex, warnings, "memory index"),
    sourceFile(root, files.invariants, warnings, "invariants"),
  ]);
  for (const file of [indexFile, invariantFile]) if (file) sources.set(file.source.path, file.source);
  const index = parseJsonSource(indexFile, warnings) ?? { incidents: [] };
  const invariantMap = new Map();
  for (const invariant of invariantSections(invariantFile?.text ?? "")) invariantMap.set(invariant.id, invariant);
  const canonicalInvariantByText = new Map();
  for (const incident of Array.isArray(index.incidents) ? index.incidents : []) {
    const key = String(incident.invariant ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (key && incident.invariantId && !canonicalInvariantByText.has(key)) canonicalInvariantByText.set(key, incident.invariantId);
  }
  const tasksByInvariant = new Map();
  const invariantSources = new Map();

  for (const incident of Array.isArray(index.incidents) ? index.incidents : []) {
    const incidentFile = incident.file
      ? await sourceFile(root, path.join(files.memory, incident.file), warnings, "incident")
      : null;
    if (incidentFile) sources.set(incidentFile.source.path, incidentFile.source);
    const source = incidentFile?.source ?? indexFile?.source;
    if (!source || !incident.id) continue;
    const id = `incident:${incident.id}`;
    builder.addNode({
      id,
      type: "Incident",
      title: incident.title ?? incident.id,
      text: [incident.rootCause, incident.invariant, ...(incident.tests ?? [])].filter(Boolean).join(" "),
      taskId: incident.sourceTask,
      tags: incident.tags ?? [],
      createdAt: incident.createdAt,
      source,
      provenance: provenance("incident-memory", [incident.id]),
    });
    if (incident.sourceTask) deferredEdges.push({
      from: id,
      type: "derived-from",
      to: `task:${incident.sourceTask}`,
      source,
      provenance: provenance("incident-memory", ["sourceTask"]),
    });
    if (incident.sourceTask && incident.sourceIssue) deferredEdges.push({
      from: id,
      type: "derived-from",
      to: `issue:${incident.sourceTask}:${incident.sourceIssue}`,
      source,
      provenance: provenance("incident-memory", ["sourceIssue"]),
    });
    if (incident.invariantId) {
      const invariantKey = String(incident.invariant ?? "").trim().replace(/\s+/g, " ").toLowerCase();
      const canonicalInvariantId = canonicalInvariantByText.get(invariantKey) ?? incident.invariantId;
      const stored = invariantMap.get(canonicalInvariantId) ?? invariantMap.get(incident.invariantId);
      const invariantId = `invariant:${canonicalInvariantId}`;
      builder.addNode({
        id: invariantId,
        type: "Invariant",
        title: stored?.title ?? canonicalInvariantId,
        text: stored?.body ?? incident.invariant ?? "",
        source: stored ? invariantFile.source : source,
        provenance: provenance(stored ? "project-invariant" : "incident-invariant", [canonicalInvariantId]),
      });
      builder.addEdge(id, "establishes", invariantId, { source, provenance: provenance("incident-memory", ["invariantId"]) });
      invariantSources.set(canonicalInvariantId, stored ? invariantFile.source : source);
      if (incident.sourceTask) {
        const tasks = tasksByInvariant.get(canonicalInvariantId) ?? new Set();
        tasks.add(incident.sourceTask);
        tasksByInvariant.set(canonicalInvariantId, tasks);
      }
    }
    for (const impactPath of incident.paths ?? []) pathNode(builder, impactPath, source, id);
  }

  for (const [invariantId, taskSet] of tasksByInvariant.entries()) {
    const taskIds = [...taskSet].sort();
    const source = invariantSources.get(invariantId);
    for (let left = 0; left < taskIds.length; left += 1) {
      for (let right = left + 1; right < taskIds.length; right += 1) {
        builder.addEdge(`task:${taskIds[left]}`, "shares-invariant-with", `task:${taskIds[right]}`, {
          source,
          provenance: provenance("derived-shared-invariant", [invariantId]),
        });
      }
    }
  }

  for (const invariant of invariantMap.values()) {
    builder.addNode({
      id: `invariant:${invariant.id}`,
      type: "Invariant",
      title: invariant.title,
      text: invariant.body,
      source: invariantFile.source,
      provenance: provenance("project-invariant", [invariant.id]),
    });
  }
}

async function addObservations(builder, root, files, sources, warnings) {
  const observationFile = await sourceFile(root, files.observations, warnings, "environment observations");
  if (!observationFile) return;
  sources.set(observationFile.source.path, observationFile.source);
  const index = parseJsonSource(observationFile, warnings);
  if (!index) return;
  for (const [position, observation] of (index.observations ?? []).entries()) {
    const identity = observation.last_verified_at ?? sha256(stableJson(observation)).slice(0, 12) ?? position;
    builder.addNode({
      id: `environment:${safeIdPart(observation.environment)}:${safeIdPart(observation.key)}:${safeIdPart(identity)}`,
      type: "EnvironmentObservation",
      title: `${observation.environment ?? "local"} ${observation.key ?? "observation"}`,
      text: [observation.value, observation.source].filter(Boolean).join(" "),
      environment: observation.environment,
      key: observation.key,
      value: observation.value,
      stale: false,
      verifiedAt: observation.last_verified_at,
      source: observationFile.source,
      provenance: provenance("environment-observation", [String(position)]),
    });
  }
  for (const [position, observation] of (index.stale ?? []).entries()) {
    const identity = observation.staleAt ?? sha256(stableJson(observation)).slice(0, 12) ?? position;
    builder.addNode({
      id: `environment:${safeIdPart(observation.environment)}:${safeIdPart(observation.key)}:${safeIdPart(identity)}`,
      type: "EnvironmentObservation",
      title: `${observation.environment ?? "local"} ${observation.key ?? "observation"} (stale)`,
      text: [observation.value, observation.supersededBy].filter(Boolean).join(" "),
      environment: observation.environment,
      key: observation.key,
      value: observation.value,
      stale: true,
      source: observationFile.source,
      provenance: provenance("stale-environment-observation", [String(position)]),
    });
  }
}

export async function buildGraph(root, options = {}) {
  const files = graphFiles(root);
  const warnings = [];
  const sources = new Map();
  const builder = makeBuilder();
  const deferredEdges = [];
  try {
    const taskIds = await taskDirectoryNames(files.tasks, warnings);
    for (const taskId of taskIds) await addTask(builder, files.root, taskId, sources, warnings, deferredEdges);
    await addMemory(builder, files.root, files, sources, warnings, deferredEdges);
    await addObservations(builder, files.root, files, sources, warnings);
    await addProjectTruth(builder, files.root, files.projectTruth, sources, warnings);
    await addKnowledgeDocuments(builder, files.root, files.standards, "Standard", sources, warnings);
    await addKnowledgeDocuments(builder, files.root, files.research, "Research", sources, warnings);
    for (const edge of deferredEdges) builder.addEdge(edge.from, edge.type, edge.to, edge);
  } catch (error) {
    warnings.push(`Graph rebuild continued with partial data: ${error.message}`);
  }

  const built = builder.finish();
  const graph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    kind: "openatdd-semantic-index",
    builtAt: nowIso(options.clock ?? (() => new Date())),
    stale: false,
    sources: [...sources.values()].sort((left, right) => left.path.localeCompare(right.path)),
    nodes: built.nodes,
    edges: built.edges,
    warnings,
  };
  graph.contentDigest = graphContentDigest(graph);

  if (options.persist) {
    try {
      await mkdir(files.knowledge, { recursive: true });
      await atomicWrite(files.graph, `${JSON.stringify(graph, null, 2)}\n`);
    } catch (error) {
      graph.warnings.push(`Graph was rebuilt in memory but could not be persisted: ${error.message}`);
    }
  }
  return graph;
}

export function validateGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== "object") return { valid: false, errors: ["Graph must be an object."] };
  if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION) errors.push(`Unsupported graph schema version: ${graph.schemaVersion}`);
  if (graph.kind !== "openatdd-semantic-index") errors.push("Graph kind is invalid.");
  if (!Array.isArray(graph.nodes)) errors.push("Graph nodes must be an array.");
  if (!Array.isArray(graph.edges)) errors.push("Graph edges must be an array.");
  if (!Array.isArray(graph.sources)) errors.push("Graph sources must be an array.");
  const nodeIds = new Set();
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!node?.id || !node?.type) errors.push("Every graph node needs a stable id and type.");
    if (nodeIds.has(node.id)) errors.push(`Duplicate graph node: ${node.id}`);
    nodeIds.add(node.id);
    if (!node?.source?.path || !node?.source?.sha256) errors.push(`Graph node lacks source provenance: ${node?.id ?? "unknown"}`);
  }
  const edgeIds = new Set();
  for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
    if (!edge?.id || !edge?.from || !edge?.to || !edge?.type) errors.push("Every graph edge needs id, from, to, and type.");
    if (edgeIds.has(edge.id)) errors.push(`Duplicate graph edge: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) errors.push(`Graph edge references an unknown node: ${edge.id}`);
    if (!edge?.source?.path || !edge?.source?.sha256) errors.push(`Graph edge lacks source provenance: ${edge?.id ?? "unknown"}`);
  }
  for (const source of Array.isArray(graph.sources) ? graph.sources : []) {
    if (!source?.path || !source?.sha256) errors.push("Every graph source needs path and sha256.");
  }
  if (graph.contentDigest && graph.contentDigest !== graphContentDigest(graph)) errors.push("Graph content digest does not match its contents.");
  return { valid: errors.length === 0, errors };
}

export async function graphStaleness(root, graph) {
  const reasons = [];
  if (graph?.stale) reasons.push("Graph carries a stale marker.");
  const validation = validateGraph(graph);
  reasons.push(...validation.errors);
  if (validation.valid && !graph.stale) {
    const current = await buildGraph(root, { persist: false });
    if (current.contentDigest !== graph.contentDigest) reasons.push("Canonical OpenATDD sources changed after the graph was built.");
    return { stale: reasons.length > 0, reasons, current };
  }
  return { stale: true, reasons, current: null };
}

export async function loadGraph(root, options = {}) {
  const files = graphFiles(root);
  let stored;
  let rebuildReason = "missing";
  try {
    stored = JSON.parse(await readFile(files.graph, "utf8"));
    const status = await graphStaleness(root, stored);
    if (!status.stale) return withLoadStatus(stored, { rebuilt: false, reasons: [] });
    rebuildReason = status.reasons.join(" ") || "stale";
    if (status.current) {
      stored = status.current;
    } else {
      stored = null;
    }
  } catch (error) {
    rebuildReason = error?.code === "ENOENT" ? "missing" : `unreadable: ${error.message}`;
    stored = null;
  }

  try {
    const graph = stored ?? await buildGraph(root, { persist: false, clock: options.clock });
    if (options.persist !== false) {
      try {
        await mkdir(files.knowledge, { recursive: true });
        await atomicWrite(files.graph, `${JSON.stringify(graph, null, 2)}\n`);
      } catch (error) {
        graph.warnings.push(`Rebuilt graph could not be persisted: ${error.message}`);
      }
    }
    return withLoadStatus(graph, { rebuilt: true, reasons: [rebuildReason] });
  } catch (error) {
    const graph = emptyGraph(options.clock, [`Graph unavailable; safe empty fallback used: ${error.message}`]);
    return withLoadStatus(graph, { rebuilt: true, reasons: [rebuildReason, error.message], fallback: true });
  }
}

function nodeSearchText(node) {
  return [node.id, node.type, node.title, node.text, node.taskId, node.acceptanceId, node.path, ...(node.tokens ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function queryGraph(graph, query, options = {}) {
  const terms = tokenize(query);
  const allowed = options.types ? new Set(options.types) : null;
  const matches = (graph?.nodes ?? [])
    .filter((node) => !allowed || allowed.has(node.type))
    .map((node) => {
      const text = nodeSearchText(node);
      const nodeTokens = new Set(node.tokens ?? []);
      const matchedTerms = terms.filter((term) => text.includes(term));
      const score = matchedTerms.reduce((total, term) => total + (nodeTokens.has(term) ? 4 : 1), 0);
      return { score, matchedTerms, node };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, options.limit ?? 20);
  return { query: String(query ?? ""), terms, matches };
}

export async function searchGraph(root, query, options = {}) {
  const graph = options.graph ?? await loadGraph(root, options);
  return { graph, ...queryGraph(graph, query, options) };
}

export function impactPathsOverlap(left, right) {
  const a = normalizeImpactPath(String(left ?? ""));
  const b = normalizeImpactPath(String(right ?? ""));
  return Boolean(a && b) && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`));
}

function taskAcceptances(graph, taskId) {
  return (graph.nodes ?? [])
    .filter((node) => node.type === "Acceptance" && node.taskId === taskId)
    .map((node) => node.acceptanceId)
    .filter(Boolean)
    .sort();
}

function taskForNode(node, nodeById) {
  if (node?.taskId) return node.taskId;
  if (node?.type === "Solution") return node.id.slice("solution:".length);
  if (node?.type === "Task") return node.id.slice("task:".length);
  const parent = [...nodeById.values()].find((candidate) => candidate.type === "Task" && candidate.id === node?.id);
  return parent?.taskId;
}

function aggregateImpact(items) {
  const aggregate = new Map();
  for (const item of items) {
    if (!item.taskId) continue;
    const prior = aggregate.get(item.taskId) ?? { taskId: item.taskId, acceptanceIds: [], reasons: [], edges: [] };
    prior.acceptanceIds.push(...(item.acceptanceIds ?? []));
    prior.reasons.push(...(item.reasons ?? []));
    prior.edges.push(...(item.edges ?? []));
    aggregate.set(item.taskId, prior);
  }
  return [...aggregate.values()].map((item) => ({
    ...item,
    acceptanceIds: [...new Set(item.acceptanceIds)].sort(),
    reasons: [...new Set(item.reasons)].sort(),
    edges: [...new Map(item.edges.map((edge) => [edge.id ?? stableJson(edge), edge])).values()],
  })).sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function findPathFallbackImpacts(graph, input = {}) {
  const taskId = input.taskId;
  const currentSolution = `solution:${taskId}`;
  const nodeById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const edges = graph?.edges ?? [];
  const currentApprovedAt = nodeById.get(currentSolution)?.approvedAt;
  const currentPaths = (input.impactPaths?.length
    ? input.impactPaths
    : edges.filter((edge) => edge.from === currentSolution && edge.type === "touches-path")
      .map((edge) => nodeById.get(edge.to)?.path))
    .filter(Boolean);
  if (currentPaths.length === 0) return [];

  const candidates = [];
  for (const edge of edges.filter((item) => item.type === "touches-path" && item.from.startsWith("solution:"))) {
    const otherTaskId = edge.from.slice("solution:".length);
    if (otherTaskId === taskId) continue;
    const otherApprovedAt = nodeById.get(edge.from)?.approvedAt;
    if (currentApprovedAt && otherApprovedAt && otherApprovedAt >= currentApprovedAt) continue;
    const otherPath = nodeById.get(edge.to)?.path;
    for (const currentPath of currentPaths) {
      if (!impactPathsOverlap(currentPath, otherPath)) continue;
      candidates.push({
        taskId: otherTaskId,
        acceptanceIds: taskAcceptances(graph, otherTaskId),
        reasons: [`path-overlap:${normalizeImpactPath(currentPath)}:${normalizeImpactPath(otherPath)}`],
        edges: [edge],
      });
    }
  }
  return aggregateImpact(candidates);
}

export function findImpactRelationships(graph, input = {}) {
  const taskId = input.taskId;
  if (!taskId) return [];
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const currentNodes = new Set(nodes.filter((node) => node.taskId === taskId || node.id === `task:${taskId}` || node.id === `solution:${taskId}`).map((node) => node.id));
  const explicit = [];
  for (const edge of edges) {
    if (!["affects", "shares-invariant-with"].includes(edge.type)) continue;
    if (!currentNodes.has(edge.from) && !currentNodes.has(edge.to)) continue;
    const otherId = currentNodes.has(edge.from) ? edge.to : edge.from;
    const other = nodeById.get(otherId);
    const otherTaskId = taskForNode(other, nodeById);
    if (!otherTaskId || otherTaskId === taskId) continue;
    explicit.push({
      taskId: otherTaskId,
      acceptanceIds: other?.type === "Acceptance" ? [other.acceptanceId] : taskAcceptances(graph, otherTaskId),
      reasons: [`semantic-${edge.type}`],
      edges: [edge],
    });
  }
  return aggregateImpact([...explicit, ...findPathFallbackImpacts(graph, input)]);
}

export async function safeImpactAnalysis(root, input = {}) {
  try {
    const graph = input.graph ?? await loadGraph(root);
    return findImpactRelationships(graph, input);
  } catch {
    return [];
  }
}

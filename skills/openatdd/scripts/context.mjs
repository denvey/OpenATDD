import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertTaskId,
  artifactLocator,
  atomicWrite,
  gitPrivateRoot,
  pathExists,
  resolveArtifactPath,
  sha256,
  toPosix,
} from "./lib.mjs";
import {
  findImpactRelationships,
  loadGraph,
  queryGraph,
} from "./graph.mjs";

const CONTEXT_SCHEMA_VERSION = 1;
const LANES = new Set(["quick", "standard", "deep"]);

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

function semanticContext(context) {
  return {
    schemaVersion: context.schemaVersion,
    taskId: context.taskId,
    lane: context.lane,
    implementation: context.implementation,
    verification: context.verification,
    sourceDigests: context.sourceDigests,
    graphDigest: context.graphDigest ?? null,
  };
}

function contextDigest(context) {
  return sha256(stableJson(semanticContext(context)));
}

function relativePath(root, target) {
  return artifactLocator(root, target);
}

function withLoadStatus(context, status) {
  Object.defineProperty(context, "loadStatus", { value: status, enumerable: false, configurable: true });
  return context;
}

export function contextFiles(root, taskId) {
  assertTaskId(taskId);
  const projectRoot = path.resolve(root);
  const task = path.join(gitPrivateRoot(projectRoot), "tasks", taskId);
  const requirement = path.join(projectRoot, ".openatdd", "requirements", `${taskId}.md`);
  return {
    root: projectRoot,
    task,
    state: path.join(task, "state.json"),
    acceptance: requirement,
    solution: requirement,
    context: path.join(task, "context.json"),
  };
}

function semanticTaskState(bytes) {
  const state = JSON.parse(bytes.toString("utf8"));
  delete state.updatedAt;
  delete state.context;
  state.history = (state.history ?? []).filter((item) => item.event !== "SCOPED_CONTEXT_PREPARED");
  return Buffer.from(stableJson(state));
}

async function sourceDescriptor(root, target, options = {}) {
  try {
    const bytes = await readFile(target);
    const digestBytes = options.semanticTaskState ? semanticTaskState(bytes) : bytes;
    return { path: relativePath(root, target), sha256: sha256(digestBytes), size: bytes.byteLength };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function safeState(files, warnings) {
  try {
    return JSON.parse(await readFile(files.state, "utf8"));
  } catch (error) {
    warnings.push(`Task state is unavailable: ${error.message}`);
    return {};
  }
}

function laneFrom(state, requested) {
  const lane = String(requested ?? state.routing?.lane ?? state.depth?.lane ?? "standard").toLowerCase();
  return LANES.has(lane) ? lane : "standard";
}

function addReference(collection, input) {
  if (!input?.path || !input?.digest) return;
  const key = `${input.type}\u0000${input.path}`;
  const prior = collection.get(key);
  if (!prior) {
    collection.set(key, {
      id: input.id ?? `source:${input.path}`,
      type: input.type,
      path: input.path,
      digest: input.digest,
      relevance: input.relevance ?? 1,
      reasons: [...new Set(input.reasons ?? [])],
      nodeIds: [...new Set(input.nodeIds ?? [])],
    });
    return;
  }
  prior.relevance = Math.max(prior.relevance, input.relevance ?? 1);
  prior.reasons = [...new Set([...prior.reasons, ...(input.reasons ?? [])])];
  prior.nodeIds = [...new Set([...prior.nodeIds, ...(input.nodeIds ?? [])])];
}

function sortedReferences(collection) {
  return [...collection.values()].sort(
    (left, right) => right.relevance - left.relevance || left.type.localeCompare(right.type) || left.path.localeCompare(right.path),
  );
}

function sourceFromNode(node) {
  if (!node?.source?.path || !node?.source?.sha256) return null;
  return { path: node.source.path, digest: node.source.sha256 };
}

function typeForNode(node) {
  return {
    Acceptance: "AcceptanceContract",
    Check: "VerificationCheck",
    CodePath: "ImpactPath",
    Decision: "Decision",
    EnvironmentObservation: "EnvironmentObservation",
    Evidence: "Evidence",
    Incident: "Incident",
    Invariant: "Invariant",
    Issue: "Issue",
    ProjectTruth: "ProjectTruth",
    Solution: "SolutionContract",
    Standard: "Standard",
    Research: "Research",
    Task: "TaskState",
  }[node.type] ?? node.type;
}

function relevantNodePolicy(lane, surface) {
  const policies = {
    implementation: {
      quick: new Set(["Decision", "Invariant", "Incident"]),
      standard: new Set(["Decision", "Invariant", "Incident", "EnvironmentObservation", "Standard"]),
      deep: new Set(["Decision", "Invariant", "Incident", "EnvironmentObservation", "Standard", "Research", "Issue", "CodePath"]),
    },
    verification: {
      quick: new Set(["Invariant", "Incident", "Acceptance"]),
      standard: new Set(["Invariant", "Incident", "Acceptance", "EnvironmentObservation", "Standard", "Check", "Evidence"]),
      deep: new Set(["Invariant", "Incident", "Acceptance", "EnvironmentObservation", "Standard", "Research", "Check", "Evidence", "Issue", "CodePath"]),
    },
  };
  return policies[surface][lane];
}

function addGraphMatches(collection, graph, query, lane, surface, limit) {
  const allowed = relevantNodePolicy(lane, surface);
  const matches = queryGraph(graph, query, { types: [...allowed], limit }).matches;
  for (const match of matches) {
    const source = sourceFromNode(match.node);
    if (!source) continue;
    addReference(collection, {
      id: `graph:${match.node.id}`,
      type: typeForNode(match.node),
      ...source,
      relevance: match.score,
      reasons: [`matched:${match.matchedTerms.join(",")}`],
      nodeIds: [match.node.id],
    });
  }
}

function addActiveEnvironment(collection, graph, surface) {
  for (const node of graph.nodes.filter((candidate) => candidate.type === "EnvironmentObservation" && !candidate.stale)) {
    const source = sourceFromNode(node);
    if (!source) continue;
    addReference(collection, {
      id: `graph:${node.id}`,
      type: "EnvironmentObservation",
      ...source,
      relevance: 1,
      reasons: [surface === "implementation" ? "active-project-environment" : "verification-environment"],
      nodeIds: [node.id],
    });
  }
}

function addProjectTruth(collection, graph, surface) {
  for (const node of graph.nodes.filter((candidate) => candidate.type === "ProjectTruth" && !candidate.stale)) {
    const source = sourceFromNode(node);
    if (!source) continue;
    addReference(collection, {
      id: `graph:${node.id}`,
      type: "ProjectTruth",
      ...source,
      relevance: 11,
      reasons: [surface === "implementation" ? "current-project-boundary" : "current-project-expectations"],
      nodeIds: [node.id],
    });
  }
}

function addHistoricalAcceptance(collection, graph, impact) {
  for (const acceptanceId of impact.acceptanceIds) {
    const node = graph.nodes.find((candidate) => (
      candidate.type === "Acceptance"
      && candidate.taskId === impact.taskId
      && candidate.acceptanceId === acceptanceId
    ));
    const source = sourceFromNode(node);
    if (!source) continue;
    addReference(collection, {
      id: `graph:${node.id}`,
      type: "HistoricalAcceptance",
      ...source,
      relevance: 10,
      reasons: impact.reasons,
      nodeIds: [node.id],
    });
  }
}

async function directReferences(files, state, implementation, verification, warnings) {
  const [stateSource, acceptanceSource, solutionSource] = await Promise.all([
    sourceDescriptor(files.root, files.state, { semanticTaskState: true }),
    sourceDescriptor(files.root, files.acceptance),
    sourceDescriptor(files.root, files.solution),
  ]);
  if (stateSource) {
    addReference(implementation, {
      type: "TaskState",
      path: stateSource.path,
      digest: stateSource.sha256,
      relevance: 10,
      reasons: ["current-task-state"],
      nodeIds: [`task:${state.taskId ?? path.basename(files.task)}`],
    });
    addReference(verification, {
      type: "TaskState",
      path: stateSource.path,
      digest: stateSource.sha256,
      relevance: 10,
      reasons: ["verification-boundary-and-status"],
      nodeIds: [`task:${state.taskId ?? path.basename(files.task)}`],
    });
  } else {
    warnings.push("Current task state was not found.");
  }
  if (acceptanceSource) {
    for (const target of [implementation, verification]) addReference(target, {
      type: "AcceptanceContract",
      path: acceptanceSource.path,
      digest: acceptanceSource.sha256,
      relevance: 12,
      reasons: [target === implementation ? "implementation-outcomes" : "verification-source-of-truth"],
      nodeIds: (state.acceptance?.items ?? []).map((item) => `acceptance:${state.taskId}:${item.id}`),
    });
  } else {
    warnings.push("Current acceptance contract was not found.");
  }
  if (solutionSource) {
    addReference(implementation, {
      type: "SolutionContract",
      path: solutionSource.path,
      digest: solutionSource.sha256,
      relevance: 12,
      reasons: ["approved-implementation-boundary"],
      nodeIds: [`solution:${state.taskId}`],
    });
    addReference(verification, {
      type: "SolutionContract",
      path: solutionSource.path,
      digest: solutionSource.sha256,
      relevance: 9,
      reasons: ["acceptance-trace-and-impact-paths"],
      nodeIds: [`solution:${state.taskId}`],
    });
  }
}

export async function buildScopedContext(root, taskId, options = {}) {
  assertTaskId(taskId);
  const files = contextFiles(root, taskId);
  const warnings = [];
  const state = await safeState(files, warnings);
  const lane = laneFrom(state, options.lane);
  let graph = options.graph;
  if (!graph) {
    try {
      graph = await loadGraph(root, { persist: options.persistGraph !== false });
    } catch (error) {
      warnings.push(`Semantic graph unavailable; direct context only: ${error.message}`);
      graph = { nodes: [], edges: [], contentDigest: null };
    }
  }

  const implementation = new Map();
  const verification = new Map();
  await directReferences(files, state, implementation, verification, warnings);
  addProjectTruth(implementation, graph, "implementation");
  addProjectTruth(verification, graph, "verification");
  const query = [
    options.query,
    state.requirement,
    ...(state.solution?.impactPaths ?? []),
    ...(state.acceptance?.items ?? []).flatMap((item) => [item.title, item.given, item.when, item.then]),
  ].filter(Boolean).join(" ");
  const limits = lane === "quick" ? { implementation: 5, verification: 5 } : lane === "deep"
    ? { implementation: 20, verification: 24 }
    : { implementation: 10, verification: 12 };
  addGraphMatches(implementation, graph, query, lane, "implementation", limits.implementation);
  addGraphMatches(verification, graph, query, lane, "verification", limits.verification);
  if (lane !== "quick") {
    addActiveEnvironment(implementation, graph, "implementation");
    addActiveEnvironment(verification, graph, "verification");
  }

  for (const impact of findImpactRelationships(graph, {
    taskId,
    impactPaths: state.solution?.impactPaths ?? [],
  })) addHistoricalAcceptance(verification, graph, impact);

  const implementationRefs = sortedReferences(implementation);
  const verificationRefs = sortedReferences(verification);
  const sourceDigests = Object.fromEntries(
    [...implementationRefs, ...verificationRefs]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((reference) => [reference.path, reference.digest]),
  );
  const currentStateSource = await sourceDescriptor(files.root, files.state, { semanticTaskState: true });
  if (currentStateSource) sourceDigests[currentStateSource.path] = currentStateSource.sha256;
  const context = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    taskId,
    lane,
    createdAt: (options.clock ?? (() => new Date()))().toISOString(),
    implementation: implementationRefs,
    verification: verificationRefs,
    sourceDigests,
    graphDigest: graph.contentDigest ?? null,
    warnings,
  };
  context.digest = contextDigest(context);
  if (options.persist) await persistScopedContext(root, context);
  return context;
}

export async function persistScopedContext(root, context) {
  const validation = validateScopedContext(context);
  if (!validation.valid) throw new Error(`Cannot persist invalid scoped context: ${validation.errors.join(" ")}`);
  const files = contextFiles(root, context.taskId);
  await mkdir(files.task, { recursive: true });
  await atomicWrite(files.context, `${JSON.stringify(context, null, 2)}\n`);
  return files.context;
}

export function validateScopedContext(context) {
  const errors = [];
  if (!context || typeof context !== "object") return { valid: false, errors: ["Context must be an object."] };
  if (context.schemaVersion !== CONTEXT_SCHEMA_VERSION) errors.push(`Unsupported context schema version: ${context.schemaVersion}`);
  if (!context.taskId) errors.push("Context requires taskId.");
  if (!LANES.has(context.lane)) errors.push(`Context lane is invalid: ${context.lane}`);
  if (!Array.isArray(context.implementation)) errors.push("Implementation context must be an array.");
  if (!Array.isArray(context.verification)) errors.push("Verification context must be an array.");
  if (!context.sourceDigests || typeof context.sourceDigests !== "object" || Array.isArray(context.sourceDigests)) {
    errors.push("Context sourceDigests must be an object.");
  }
  for (const reference of [...(Array.isArray(context.implementation) ? context.implementation : []), ...(Array.isArray(context.verification) ? context.verification : [])]) {
    if (!reference?.type || !reference?.path || !reference?.digest) errors.push("Every context reference needs type, path, and digest.");
    if (typeof reference?.relevance !== "number") errors.push(`Context reference lacks numeric relevance: ${reference?.path ?? "unknown"}`);
  }
  if (context.digest && context.digest !== contextDigest(context)) errors.push("Context digest does not match its contents.");
  return { valid: errors.length === 0, errors };
}

export async function checkContextStaleness(root, context, options = {}) {
  const reasons = [];
  const validation = validateScopedContext(context);
  reasons.push(...validation.errors);
  for (const [relative, expected] of Object.entries(context?.sourceDigests ?? {})) {
    const target = resolveArtifactPath(root, relative);
    const currentTaskState = relative === `git:tasks/${context.taskId}/state.json`;
    const source = await sourceDescriptor(root, target, { semanticTaskState: currentTaskState });
    if (!source) reasons.push(`Context source is missing: ${relative}`);
    else if (source.sha256 !== expected) reasons.push(`Context source changed: ${relative}`);
  }
  if (context?.graphDigest && options.checkGraph === true) {
    try {
      const graph = options.graph ?? await loadGraph(root, { persist: false });
      if (graph.contentDigest !== context.graphDigest) reasons.push("Semantic graph changed after context creation.");
    } catch (error) {
      reasons.push(`Semantic graph could not be checked: ${error.message}`);
    }
  }
  return { stale: reasons.length > 0, reasons };
}

export async function loadScopedContext(root, taskId, options = {}) {
  const files = contextFiles(root, taskId);
  let stored;
  let reason = "missing";
  if (await pathExists(files.context)) {
    try {
      stored = JSON.parse(await readFile(files.context, "utf8"));
      const staleness = await checkContextStaleness(root, stored, options);
      if (!staleness.stale) return withLoadStatus(stored, { rebuilt: false, reasons: [] });
      reason = staleness.reasons.join(" ") || "stale";
    } catch (error) {
      reason = `unreadable: ${error.message}`;
    }
  }
  const rebuilt = await buildScopedContext(root, taskId, {
    ...options,
    persist: Boolean(options.persist),
  });
  return withLoadStatus(rebuilt, { rebuilt: true, reasons: [reason] });
}

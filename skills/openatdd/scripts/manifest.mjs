import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  assert,
  filesBelow,
  normalizeImpactPath,
  pathExists,
  readJson,
  resolveInside,
  sha256,
  toPosix,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const SCOPES = ["focused", "module", "broad"];
const SURFACES = new Set(["cli", "api", "web", "file", "mixed"]);
const HARD_EXCLUDES = Object.freeze([
  ".git/**",
  ".env.openatdd.local",
  ".openatdd/tasks/**",
  ".openatdd/memory/**",
  ".openatdd/knowledge/graph.json",
  ".openatdd/transactions/**",
  ".openatdd/reverification/**",
  ".openatdd/environments/observations.json",
  "node_modules/**",
  "coverage/**",
  ".cache/**",
  ".DS_Store",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function globExpression(pattern) {
  let source = "";
  const normalized = normalizeImpactPath(pattern);
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(value, pattern) {
  return globExpression(pattern).test(normalizeImpactPath(value));
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => matchesGlob(value, pattern));
}

function stringList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function validateCommand(command, label, errors) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(command.id ?? ""))) errors.push(`${label} requires a lowercase hyphenated id.`);
  if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((item) => typeof item !== "string" || !item)) {
    errors.push(`${label}.argv must be a non-empty string array.`);
  }
  if (command.cwd !== undefined) {
    const cwd = typeof command.cwd === "string" ? command.cwd.trim() : "";
    const normalized = cwd ? path.normalize(cwd) : "";
    if (!cwd || path.isAbsolute(cwd) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
      errors.push(`${label}.cwd must stay inside the project as a relative path.`);
    }
  }
  if (command.timeoutMs !== undefined && (!Number.isFinite(Number(command.timeoutMs)) || Number(command.timeoutMs) <= 0)) errors.push(`${label}.timeoutMs must be positive.`);
  if (command.env !== undefined && (!Array.isArray(command.env) || command.env.some((item) => !/^[A-Z_][A-Z0-9_]*$/.test(String(item))))) {
    errors.push(`${label}.env may contain only environment variable names.`);
  }
  if (command.expectedExitCodes !== undefined && (!Array.isArray(command.expectedExitCodes) || command.expectedExitCodes.some((item) => !Number.isInteger(item)))) {
    errors.push(`${label}.expectedExitCodes must contain integers.`);
  }
}

function allCommandIds(manifest) {
  return [
    ...(manifest.preflight?.commands ?? []),
    ...(manifest.dryRun?.commands ?? []),
    ...(manifest.checks ?? []).flatMap((group) => group.commands ?? []),
    ...(manifest.uat?.batches ?? []).flatMap((batch) => batch.commands ?? []),
  ].map((command) => command.id);
}

export function validateFinalizationManifest(manifest, acceptanceItems = []) {
  const errors = [];
  const warnings = [];
  if (manifest?.schemaVersion !== 1) errors.push("Finalization manifest schemaVersion must be 1.");
  if (!SURFACES.has(manifest?.surface)) errors.push("Finalization manifest surface must be cli, api, web, file, or mixed.");
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(manifest?.environment ?? ""))) errors.push("Finalization manifest requires a lowercase environment name.");

  const includes = stringList(manifest?.source?.include);
  const excludes = stringList(manifest?.source?.exclude);
  if (includes.length === 0) errors.push("source.include requires at least one glob.");
  if (includes.some((item) => !item.trim()) || excludes.some((item) => !item.trim())) errors.push("Source globs cannot be empty.");

  const dryCommands = manifest?.dryRun?.commands;
  if (!Array.isArray(dryCommands) || dryCommands.length === 0) errors.push("dryRun.commands requires at least one real smoke command.");
  for (const [index, command] of (dryCommands ?? []).entries()) validateCommand(command, `dryRun.commands[${index}]`, errors);

  if (manifest?.preflight !== undefined && (!manifest.preflight || typeof manifest.preflight !== "object" || Array.isArray(manifest.preflight))) {
    errors.push("preflight must be an object when provided.");
  }
  const preflightCommands = manifest?.preflight?.commands;
  if (preflightCommands !== undefined && (!Array.isArray(preflightCommands) || preflightCommands.length === 0)) {
    errors.push("preflight.commands must be a non-empty command array when provided.");
  }
  for (const [index, command] of (preflightCommands ?? []).entries()) {
    validateCommand(command, `preflight.commands[${index}]`, errors);
  }

  const checks = manifest?.checks;
  if (!Array.isArray(checks) || checks.length === 0) errors.push("checks requires at least one scoped group.");
  let previousRank = -1;
  let broadGroups = 0;
  for (const [index, group] of (checks ?? []).entries()) {
    const label = `checks[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(group.id ?? ""))) errors.push(`${label} requires an id.`);
    const rank = SCOPES.indexOf(group.scope);
    if (rank === -1) errors.push(`${label}.scope must be focused, module, or broad.`);
    else if (rank < previousRank) errors.push("Check groups must be ordered focused → module → broad.");
    else previousRank = rank;
    if (group.scope === "broad") broadGroups += 1;
    if (!Array.isArray(group.commands) || group.commands.length === 0) errors.push(`${label}.commands cannot be empty.`);
    for (const [commandIndex, command] of (group.commands ?? []).entries()) validateCommand(command, `${label}.commands[${commandIndex}]`, errors);
  }
  if (broadGroups !== 1) errors.push("Exactly one broad check group is required.");

  const batches = manifest?.uat?.batches;
  if (!Array.isArray(batches) || batches.length === 0 || batches.length > 5) errors.push("uat.batches requires one to five cohesive batches.");
  const acceptanceById = new Map(acceptanceItems.map((criterion) => [criterion.id, criterion]));
  const covered = new Set();
  for (const [index, batch] of (batches ?? []).entries()) {
    const label = `uat.batches[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(batch.id ?? ""))) errors.push(`${label} requires an id.`);
    if (!batch.name?.trim()) errors.push(`${label} requires a name.`);
    if (!Array.isArray(batch.acceptanceIds) || batch.acceptanceIds.length === 0) errors.push(`${label}.acceptanceIds cannot be empty.`);
    for (const acceptanceId of batch.acceptanceIds ?? []) {
      covered.add(acceptanceId);
      if (!acceptanceById.has(acceptanceId)) errors.push(`${label} references unknown acceptance: ${acceptanceId}.`);
    }
    if (batch.runner === "internal") {
      if ((batch.commands?.length ?? 0) > 0) errors.push(`${label} internal batches cannot declare commands.`);
      for (const acceptanceId of batch.acceptanceIds ?? []) {
        if (acceptanceById.get(acceptanceId)?.classification === "AUTO") {
          errors.push(`${label} runner: internal cannot cover automatic acceptance ${acceptanceId}; execute a real UAT command instead.`);
        }
      }
    } else {
      if (!Array.isArray(batch.commands) || batch.commands.length === 0) errors.push(`${label} requires commands or runner: internal.`);
      for (const [commandIndex, command] of (batch.commands ?? []).entries()) validateCommand(command, `${label}.commands[${commandIndex}]`, errors);
    }
  }
  for (const criterion of acceptanceItems) if (!covered.has(criterion.id)) errors.push(`UAT batches do not cover ${criterion.id}.`);

  const ids = allCommandIds(manifest);
  for (const id of new Set(ids)) if (ids.filter((value) => value === id).length > 1) errors.push(`Command ID must be unique: ${id}.`);

  const validReferences = new Set([
    ...(checks ?? []).map((group) => `check:${group.id}`),
    ...(batches ?? []).map((batch) => `batch:${batch.id}`),
  ]);
  const mapping = manifest?.acceptance;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) errors.push("acceptance must map every criterion to evidence references.");
  for (const criterion of acceptanceItems) {
    const references = mapping?.[criterion.id];
    if (!Array.isArray(references) || references.length === 0) errors.push(`acceptance.${criterion.id} requires evidence references.`);
    for (const reference of references ?? []) if (!validReferences.has(reference)) errors.push(`acceptance.${criterion.id} references unknown evidence: ${reference}.`);
  }

  if (manifest?.history?.mode !== "deferred") errors.push("history.mode must be deferred.");
  if (manifest?.history?.overrides !== undefined && !Array.isArray(manifest.history.overrides)) errors.push("history.overrides must be an array.");
  for (const [index, override] of (manifest?.history?.overrides ?? []).entries()) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(override.taskId ?? ""))) errors.push(`history.overrides[${index}] requires taskId.`);
    if (!Array.isArray(override.acceptanceIds) || override.acceptanceIds.length === 0) errors.push(`history override ${override.taskId} requires acceptanceIds.`);
    if (!Array.isArray(override.evidenceFrom) || override.evidenceFrom.length === 0) errors.push(`history override ${override.taskId} requires evidenceFrom.`);
    for (const reference of override.evidenceFrom ?? []) if (!validReferences.has(reference)) errors.push(`history override ${override.taskId} references unknown evidence: ${reference}.`);
  }

  for (const [key, value] of Object.entries(manifest?.budgets ?? {})) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) errors.push(`Budget ${key} must be a non-negative number.`);
  }
  if ((manifest?.uat?.batches?.length ?? 0) > 3) warnings.push("More than three UAT batches may increase protocol round trips.");
  return { valid: errors.length === 0, errors, warnings, parsed: manifest };
}

export async function loadFinalizationManifest(root, taskId, candidate = undefined) {
  const manifestPath = candidate
    ? resolveInside(root, candidate).resolved
    : path.join(path.resolve(root), ".openatdd", "finalization.json");
  assert(await pathExists(manifestPath), "FINALIZATION_MANIFEST_NOT_FOUND", `Finalization manifest does not exist: ${path.relative(root, manifestPath)}`);
  const manifest = await readJson(manifestPath);
  return {
    manifest,
    manifestPath,
    relativePath: toPosix(path.relative(path.resolve(root), manifestPath)),
    digest: sha256(canonicalJson(manifest)),
    taskId,
  };
}

async function gitFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--cached", "--modified", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return [...new Set(Buffer.from(stdout).toString("utf8").split("\0").filter(Boolean).map(normalizeImpactPath))];
  } catch {
    return null;
  }
}

async function fallbackFiles(root) {
  return (await filesBelow(root)).map((file) => toPosix(path.relative(root, file)));
}

async function inventoryItem(root, relative) {
  const absolute = path.join(root, relative);
  try {
    const info = await lstat(absolute);
    if (info.isDirectory()) return null;
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      return { path: relative, mode: info.mode & 0o777, size: Buffer.byteLength(target), sha256: sha256(`symlink:${target}`), type: "symlink" };
    }
    const bytes = await readFile(absolute);
    return { path: relative, mode: info.mode & 0o777, size: info.size, sha256: sha256(bytes), type: "file" };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: relative, mode: 0, size: 0, sha256: sha256("missing"), type: "missing" };
    throw error;
  }
}

export async function fingerprintProject(root, source = {}) {
  const projectRoot = path.resolve(root);
  const includes = stringList(source.include).length > 0 ? stringList(source.include) : ["**/*"];
  const excludes = [...HARD_EXCLUDES, ...stringList(source.exclude)];
  const discovered = await gitFiles(projectRoot) ?? await fallbackFiles(projectRoot);
  const selected = [...new Set(discovered.map(normalizeImpactPath))]
    .filter((relative) => matchesAny(relative, includes) && !matchesAny(relative, excludes))
    .sort();
  const files = [];
  for (const relative of selected) {
    const item = await inventoryItem(projectRoot, relative);
    if (item) files.push(item);
  }
  const fingerprint = sha256(files.map((item) => `${item.path}\0${item.type}\0${item.mode}\0${item.size}\0${item.sha256}`).join("\n"));
  return { fingerprint, files, count: files.length, includes, excludes };
}

export function resolveCommand(root, command) {
  const cwd = resolveInside(root, command.cwd || ".").resolved;
  return {
    ...command,
    cwd,
    timeoutMs: Number(command.timeoutMs ?? 300000),
    expectedExitCodes: command.expectedExitCodes ?? [0],
    env: command.env ?? [],
  };
}

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class OpenATDDError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OpenATDDError";
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, code, message, details = undefined) {
  if (!condition) {
    throw new OpenATDDError(code, message, details);
  }
}

export function isoNow(clock = () => new Date()) {
  return clock().toISOString();
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function readUtf8(target) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new OpenATDDError("FILE_NOT_FOUND", `Required file does not exist: ${target}`);
    }
    throw error;
  }
}

export async function readJson(target) {
  const raw = await readUtf8(target);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new OpenATDDError("INVALID_JSON", `Invalid JSON in ${target}: ${error.message}`);
  }
}

export async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

export async function writeJson(target, value) {
  await atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
}

function absoluteInside(root, target) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(target);
  const relative = path.relative(projectRoot, absolute);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertAbsoluteInsideRoots(roots, target) {
  const absolute = path.resolve(target);
  assert(
    roots.some((root) => absoluteInside(root, absolute)),
    "PATH_OUTSIDE_ALLOWED_ROOTS",
    `Transaction target leaves the project and Git-private roots: ${target}`,
  );
  return absolute;
}

export function gitPrivateRoot(root) {
  const projectRoot = path.resolve(root);
  try {
    const resolved = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-path", "openatdd"],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (resolved) return path.resolve(projectRoot, resolved);
  } catch {
    // Keep non-Git fixture projects private as well. Real delivery projects are
    // expected to be Git repositories, where the branch above is authoritative.
  }
  return path.join(tmpdir(), "openatdd-runtime", sha256(projectRoot));
}

export function artifactLocator(root, target) {
  const projectRoot = path.resolve(root);
  const runtimeRoot = gitPrivateRoot(projectRoot);
  const absolute = path.resolve(target);
  if (absoluteInside(runtimeRoot, absolute)) return `git:${toPosix(path.relative(runtimeRoot, absolute))}`;
  if (absoluteInside(projectRoot, absolute)) return `project:${toPosix(path.relative(projectRoot, absolute))}`;
  throw new OpenATDDError("PATH_OUTSIDE_ALLOWED_ROOTS", `Artifact leaves the project and Git-private roots: ${target}`);
}

export function resolveArtifactPath(root, locator) {
  const value = String(locator);
  if (value.startsWith("project:")) return resolveInside(root, value.slice("project:".length)).resolved;
  if (value.startsWith("git:")) return resolveInside(gitPrivateRoot(root), value.slice("git:".length)).resolved;
  if (path.isAbsolute(value)) {
    artifactLocator(root, value);
    return path.resolve(value);
  }
  return resolveInside(root, value).resolved;
}

async function rollbackJournal(roots, journal) {
  for (const entry of [...journal.entries].reverse()) {
    const target = assertAbsoluteInsideRoots(roots, entry.target);
    const before = assertAbsoluteInsideRoots(roots, entry.before);
    await mkdir(path.dirname(target), { recursive: true });
    if (entry.existed) {
      const content = await readFile(before);
      await atomicWrite(target, content);
    } else {
      await rm(target, { force: true });
    }
  }
}

export async function recoverTransactions(root) {
  const projectRoot = path.resolve(root);
  const runtimeRoot = gitPrivateRoot(projectRoot);
  const roots = [projectRoot, runtimeRoot];
  const directory = path.join(runtimeRoot, "transactions");
  if (!(await pathExists(directory))) return [];
  const recovered = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const transaction = path.join(directory, entry.name);
    const journalPath = path.join(transaction, "journal.json");
    if (!(await pathExists(journalPath))) {
      await rm(transaction, { recursive: true, force: true });
      continue;
    }
    const journal = await readJson(journalPath);
    if (journal.status !== "committed") {
      await rollbackJournal(roots, journal);
      recovered.push(journal.id);
    }
    await rm(transaction, { recursive: true, force: true });
  }
  return recovered;
}

export async function atomicWriteBatch(root, entries, clock = () => new Date()) {
  assert(Array.isArray(entries) && entries.length > 0, "TRANSACTION_EMPTY", "A file transaction requires entries.");
  const projectRoot = path.resolve(root);
  const runtimeRoot = gitPrivateRoot(projectRoot);
  const roots = [projectRoot, runtimeRoot];
  const id = `txn-${clock().toISOString().replace(/[^0-9]/g, "")}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(runtimeRoot, "transactions", id);
  await mkdir(directory, { recursive: true });
  const seen = new Set();
  const journal = { schemaVersion: 1, id, status: "preparing", createdAt: isoNow(clock), entries: [] };
  try {
    for (const [index, input] of entries.entries()) {
      const target = assertAbsoluteInsideRoots(roots, input.target);
      assert(!seen.has(target), "TRANSACTION_DUPLICATE_TARGET", `Duplicate transaction target: ${target}`);
      seen.add(target);
      const existed = await pathExists(target);
      const before = path.join(directory, `before-${String(index).padStart(4, "0")}`);
      const after = path.join(directory, `after-${String(index).padStart(4, "0")}`);
      if (existed) await writeFile(before, await readFile(target));
      await writeFile(after, input.content);
      journal.entries.push({ target, before, after, existed });
    }
    journal.status = "prepared";
    await writeJson(path.join(directory, "journal.json"), journal);
    for (const entry of journal.entries) {
      await mkdir(path.dirname(entry.target), { recursive: true });
      await rename(entry.after, entry.target);
    }
    journal.status = "committed";
    await writeJson(path.join(directory, "journal.json"), journal);
    await rm(directory, { recursive: true, force: true });
    return { id, files: journal.entries.map((entry) => entry.target) };
  } catch (error) {
    if (journal.entries.length > 0) await rollbackJournal(roots, journal);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeImpactPath(value) {
  return toPosix(value.trim().replace(/^\.\//, "").replace(/\/$/, ""));
}

export function assertTaskId(taskId) {
  assert(
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(taskId),
    "INVALID_TASK_ID",
    "Task ID must contain only lowercase letters, digits, and hyphens (maximum 63 characters).",
  );
  return taskId;
}

export function resolveInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  assert(
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
    "PATH_OUTSIDE_PROJECT",
    `Path must stay inside the project root: ${candidate}`,
  );
  return { resolved, relative: toPosix(relative) };
}

export function asArray(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

export async function captureEvidence(root, values, notBefore, clock = () => new Date()) {
  const evidencePaths = asArray(values);
  assert(evidencePaths.length > 0, "EVIDENCE_REQUIRED", "At least one evidence file is required.");

  const minimum = notBefore ? new Date(notBefore).getTime() : 0;
  const capturedAt = isoNow(clock);
  const captured = [];

  for (const value of evidencePaths) {
    const resolved = resolveArtifactPath(root, value);
    const relative = artifactLocator(root, resolved);
    let info;
    try {
      info = await stat(resolved);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new OpenATDDError("EVIDENCE_NOT_FOUND", `Evidence file does not exist: ${value}`);
      }
      throw error;
    }
    assert(info.isFile(), "INVALID_EVIDENCE", `Evidence must be a regular file: ${value}`);
    assert(
      info.mtimeMs + 1000 >= minimum,
      "STALE_EVIDENCE",
      `Evidence predates the latest required verification boundary: ${value}`,
      { notBefore },
    );
    const bytes = await readFile(resolved);
    captured.push({
      path: relative,
      sha256: sha256(bytes),
      size: info.size,
      modifiedAt: new Date(info.mtimeMs).toISOString(),
      capturedAt,
    });
  }

  return captured;
}

export async function verifyCapturedEvidence(root, captured, notBefore) {
  const errors = [];
  const minimum = notBefore ? new Date(notBefore).getTime() : 0;

  for (const item of captured ?? []) {
    try {
      const resolved = resolveArtifactPath(root, item.path);
      const info = await stat(resolved);
      if (!info.isFile()) {
        errors.push(`Evidence is no longer a file: ${item.path}`);
        continue;
      }
      const bytes = await readFile(resolved);
      if (sha256(bytes) !== item.sha256) {
        errors.push(`Evidence changed after it was recorded: ${item.path}`);
      }
      if (new Date(item.capturedAt).getTime() < minimum) {
        errors.push(`Evidence is older than the latest verification boundary: ${item.path}`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        errors.push(`Evidence is missing: ${item.path}`);
      } else {
        errors.push(error.message);
      }
    }
  }

  return errors;
}

export function tokenize(value) {
  return [...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [])];
}

export function inferHumanLanguage(...values) {
  const text = values.flat(Infinity).filter(Boolean).join(" ");
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text) ? "zh-CN" : "en";
}

export function createRedactor(secretValues = []) {
  const secrets = [...new Set(asArray(secretValues).map(String).filter((value) => value.length >= 3))]
    .sort((left, right) => right.length - left.length);
  return (value) => secrets.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    String(value ?? ""),
  );
}

export function assertNoSecretValues(value, secretValues = [], label = "Persisted artifact") {
  const text = String(value ?? "");
  const matches = [...new Set(asArray(secretValues).map(String).filter((secret) => secret.length >= 3 && text.includes(secret)))];
  assert(matches.length === 0, "SECRET_LEAK", `${label} contains a loaded credential value.`, {
    matches: matches.map(() => "[REDACTED]"),
  });
}

export async function filesBelow(directory) {
  const results = [];
  if (!(await pathExists(directory))) return results;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesBelow(target));
    else if (entry.isFile()) results.push(target);
  }
  return results;
}

export async function scanFilesForSecrets(directory, secretValues = [], exclusions = []) {
  const excluded = new Set(exclusions.map((value) => path.resolve(value)));
  const leaks = [];
  for (const file of await filesBelow(directory)) {
    if (excluded.has(path.resolve(file))) continue;
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "EISDIR" || error?.code === "ERR_INVALID_ARG_TYPE") continue;
      throw error;
    }
    for (const secret of [...new Set(asArray(secretValues).map(String).filter((value) => value.length >= 3))]) {
      if (content.includes(secret)) {
        leaks.push({ path: file, value: "[REDACTED]" });
        break;
      }
    }
  }
  return leaks;
}

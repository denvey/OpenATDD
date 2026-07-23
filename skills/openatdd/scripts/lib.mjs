import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
    const { resolved, relative } = resolveInside(root, String(value));
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
      const { resolved } = resolveInside(root, item.path);
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

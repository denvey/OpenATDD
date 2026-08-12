import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assert,
  assertNoSecretValues,
  atomicWrite,
  captureEvidence,
  createRedactor,
  filesBelow,
  isoNow,
  pathExists,
  readJson,
  resolveInside,
  scanFilesForSecrets,
  writeJson,
} from "./lib.mjs";

const PROFILE_KEYS = new Set([
  "schema_version",
  "environment",
  "project_id",
  "workspace",
  "surface",
  "application_version",
  "start_command",
  "service_urls",
  "entry_url",
  "role",
  "organization",
  "fixture",
  "integration",
  "known_workarounds",
  "credential_variables",
  "source",
  "last_verified_at",
  "discovery_budget_seconds",
  "browser_round_trip_budget",
]);

const OBSERVABLE_KEYS = new Set([...PROFILE_KEYS].filter((key) => ![
  "schema_version",
  "environment",
].includes(key)));

const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;

function environmentName(value = "local") {
  const name = String(value).trim();
  assert(/^[a-z0-9][a-z0-9-]{0,31}$/.test(name), "INVALID_ENVIRONMENT", "Environment must contain lowercase letters, digits, or hyphens.");
  return name;
}

export function environmentFiles(root, environment = "local") {
  const projectRoot = path.resolve(root);
  const name = environmentName(environment);
  const openatdd = path.join(projectRoot, ".openatdd");
  const environments = path.join(openatdd, "environments");
  return {
    root: projectRoot,
    openatdd,
    environments,
    profile: path.join(environments, `${name}.yaml`),
    observations: path.join(environments, "observations.json"),
    dotenv: path.join(projectRoot, ".env.openatdd.local"),
    dotenvExample: path.join(projectRoot, ".env.openatdd.example"),
    gitignore: path.join(projectRoot, ".gitignore"),
    environment: name,
  };
}

function decodeScalar(raw, lineNumber) {
  const value = raw.trim();
  assert(!/[\n\r]/.test(value), "INVALID_PROFILE", `Multiline values are not supported at line ${lineNumber}.`);
  assert(!/^(?:!|&|\*|\||>)/.test(value), "INVALID_PROFILE", `YAML tags, anchors, aliases, and blocks are not supported at line ${lineNumber}.`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    assert(!inner.includes(value[0]), "INVALID_PROFILE", `Embedded quote requires an unsupported escape at line ${lineNumber}.`);
    return inner;
  }
  assert(!/[{}\[\]]/.test(value), "INVALID_PROFILE", `Inline YAML collections are not supported at line ${lineNumber}.`);
  return value;
}

export function parseFlatYaml(text) {
  const parsed = {};
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    assert(!/^\s/.test(rawLine), "INVALID_PROFILE", `Nested YAML is not supported at line ${lineNumber}.`);
    const separator = rawLine.indexOf(":");
    assert(separator > 0, "INVALID_PROFILE", `Expected key: value at line ${lineNumber}.`);
    const key = rawLine.slice(0, separator).trim();
    assert(/^[a-z][a-z0-9_]*$/.test(key), "INVALID_PROFILE", `Invalid profile key at line ${lineNumber}: ${key}`);
    assert(PROFILE_KEYS.has(key), "UNKNOWN_PROFILE_KEY", `Unknown environment profile key: ${key}`);
    assert(parsed[key] === undefined, "DUPLICATE_PROFILE_KEY", `Duplicate environment profile key: ${key}`);
    parsed[key] = decodeScalar(rawLine.slice(separator + 1), lineNumber);
  }
  assert(String(parsed.schema_version ?? "") === "1", "INVALID_PROFILE_VERSION", "Environment profile schema_version must be 1.");
  assert(parsed.environment, "INVALID_PROFILE", "Environment profile requires environment.");
  return parsed;
}

function encodeScalar(value) {
  const text = String(value ?? "");
  if (!text || /^\s|\s$/.test(text) || /[:#'"{}\[\]]/.test(text)) return JSON.stringify(text);
  return text;
}

export function renderFlatYaml(profile) {
  const unknown = Object.keys(profile).filter((key) => !PROFILE_KEYS.has(key));
  assert(unknown.length === 0, "UNKNOWN_PROFILE_KEY", `Unknown environment profile keys: ${unknown.join(", ")}`);
  const ordered = [...PROFILE_KEYS].filter((key) => profile[key] !== undefined);
  return `${ordered.map((key) => `${key}: ${encodeScalar(profile[key])}`).join("\n")}\n`;
}

function defaultProfile(root, environment) {
  return {
    schema_version: "1",
    environment,
    project_id: path.basename(path.resolve(root)),
    workspace: ".",
    surface: "cli",
    application_version: "n/a",
    start_command: "n/a",
    service_urls: "n/a",
    entry_url: "n/a",
    role: "n/a",
    organization: "n/a",
    fixture: "n/a",
    integration: "n/a",
    known_workarounds: "none",
    credential_variables: "",
    source: "openatdd init",
    last_verified_at: "never",
    discovery_budget_seconds: "300",
    browser_round_trip_budget: "12",
  };
}

async function appendIgnore(files) {
  const existing = await pathExists(files.gitignore) ? await readFile(files.gitignore, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  if (lines.some((line) => line.trim() === ".env.openatdd.local")) return;
  const suffix = `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}# OpenATDD local-only test credentials\n.env.openatdd.local\n`;
  await atomicWrite(files.gitignore, suffix);
}

export async function ensureEnvironmentInfrastructure(root, environment = "local") {
  const files = environmentFiles(root, environment);
  await mkdir(files.environments, { recursive: true });
  if (!(await pathExists(files.profile))) await atomicWrite(files.profile, renderFlatYaml(defaultProfile(root, files.environment)));
  if (!(await pathExists(files.observations))) await writeJson(files.observations, { schemaVersion: 1, observations: [], stale: [] });
  if (!(await pathExists(files.dotenvExample))) {
    await atomicWrite(files.dotenvExample, "# Local UAT variables. Copy to .env.openatdd.local and fill values.\n");
  }
  await appendIgnore(files);
  return files;
}

export async function loadEnvironmentProfile(root, environment = "local") {
  const files = await ensureEnvironmentInfrastructure(root, environment);
  const profile = parseFlatYaml(await readFile(files.profile, "utf8"));
  assert(profile.environment === files.environment, "PROFILE_ENVIRONMENT_MISMATCH", `Profile environment is ${profile.environment}, expected ${files.environment}.`);
  return { files, profile };
}

export function parseRestrictedDotenv(text) {
  const values = {};
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    assert(!line.startsWith("export "), "UNSAFE_DOTENV", `Shell export syntax is not allowed at line ${index + 1}.`);
    const separator = line.indexOf("=");
    assert(separator > 0, "INVALID_DOTENV", `Expected NAME=value at line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    assert(/^[A-Z_][A-Z0-9_]*$/.test(key), "INVALID_DOTENV_KEY", `Invalid variable name at line ${index + 1}: ${key}`);
    assert(values[key] === undefined, "DUPLICATE_DOTENV_KEY", `Duplicate dotenv variable: ${key}`);
    let value = line.slice(separator + 1).trim();
    assert(!(value.startsWith('"') !== value.endsWith('"')) && !(value.startsWith("'") !== value.endsWith("'")), "INVALID_DOTENV", `Mismatched quotes at line ${index + 1}.`);
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    else assert(!/\s/.test(value), "UNSAFE_DOTENV", `Unquoted whitespace is not allowed at line ${index + 1}.`);
    assert(!/\$|`|&&|\|\||[<>;]/.test(value), "UNSAFE_DOTENV", `Interpolation, command substitution, and shell syntax are forbidden at line ${index + 1}.`);
    values[key] = value;
  }
  return values;
}

function csv(value) {
  if (!value || ["n/a", "none"].includes(String(value).toLowerCase())) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export async function loadLocalCredentials(root, variableNames) {
  const files = environmentFiles(root);
  const names = csv(variableNames);
  if (names.length === 0) return { values: {}, secretValues: [], files };
  assert(await pathExists(files.dotenv), "DOTENV_NOT_FOUND", "Create .env.openatdd.local from .env.openatdd.example before UAT.");
  const parsed = parseRestrictedDotenv(await readFile(files.dotenv, "utf8"));
  const missing = names.filter((name) => !parsed[name]);
  assert(missing.length === 0, "MISSING_CREDENTIAL_VARIABLE", `Missing required local UAT variables: ${missing.join(", ")}`);
  const values = Object.fromEntries(names.map((name) => [name, parsed[name]]));
  return { values, secretValues: Object.values(values), files };
}

/**
 * Load whatever declared local values actually exist, for redaction and leak
 * scanning only. Unlike loadLocalCredentials nothing is required: project-scoped
 * verification does not use credentials, but any values that do exist locally
 * must still be redacted from and scanned out of every persisted artifact.
 */
export async function loadScanOnlyCredentials(root, variableNames) {
  const files = environmentFiles(root);
  const names = csv(variableNames);
  if (names.length === 0 || !(await pathExists(files.dotenv))) return { values: {}, secretValues: [], files };
  const parsed = parseRestrictedDotenv(await readFile(files.dotenv, "utf8"));
  const values = Object.fromEntries(names.filter((name) => parsed[name]).map((name) => [name, parsed[name]]));
  return { values, secretValues: Object.values(values), files };
}

async function refreshExample(files, variableNames) {
  const names = csv(variableNames);
  const body = ["# Local UAT variables. Copy to .env.openatdd.local and fill values.", ...names.map((name) => `${name}=`), ""].join("\n");
  await atomicWrite(files.dotenvExample, body);
}

export async function observeEnvironment(root, environment, input, clock = () => new Date()) {
  const { files, profile } = await loadEnvironmentProfile(root, environment);
  const key = String(input.key ?? "").trim();
  const value = String(input.value ?? "").trim();
  assert(OBSERVABLE_KEYS.has(key), "INVALID_OBSERVATION_KEY", `Environment key cannot be observed: ${key}`);
  assert(key === "credential_variables" || !SECRET_KEY.test(key), "SECRET_PROFILE_KEY", "Credential values must stay in .env.openatdd.local.");
  if (key === "credential_variables") {
    const names = csv(value);
    assert(names.every((name) => /^[A-Z_][A-Z0-9_]*$/.test(name)), "INVALID_CREDENTIAL_REFERENCE", "credential_variables may contain only environment variable names.");
  }
  if (key !== "credential_variables") {
    const credentials = await loadLocalCredentials(root, profile.credential_variables);
    assertNoSecretValues(value, credentials.secretValues, "Environment observation");
    assertNoSecretValues(input.source, credentials.secretValues, "Environment observation source");
  }
  assert(value, "OBSERVATION_VALUE_REQUIRED", "A non-empty observed value is required.");
  assert(input.source?.trim(), "OBSERVATION_SOURCE_REQUIRED", "A source description is required.");
  const evidence = await captureEvidence(files.root, input.evidence, null, clock);
  const now = isoNow(clock);
  const index = await readJson(files.observations);
  const prior = profile[key];
  if (prior !== undefined && prior !== value) {
    index.stale.push({ environment: files.environment, key, value: prior, supersededBy: value, staleAt: now });
  }
  profile[key] = value;
  profile.source = input.source.trim();
  profile.last_verified_at = now;
  index.observations.push({
    environment: files.environment,
    key,
    value,
    source: input.source.trim(),
    last_verified_at: now,
    evidence,
  });
  await atomicWrite(files.profile, renderFlatYaml(profile));
  await writeJson(files.observations, index);
  if (key === "credential_variables") await refreshExample(files, value);
  return { files, profile, observation: index.observations.at(-1), stale: index.stale };
}

async function reachable(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return { passed: response.status >= 200 && response.status < 500, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { passed: false, detail: error.name === "AbortError" ? "timed out" : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertionStatus(root, assertions, name, applicable, description, notBefore, clock) {
  if (!applicable) return { name, status: "not_applicable", detail: description };
  const assertion = assertions?.[name];
  if (assertion?.status !== "passed") {
    return {
      name,
      status: "failed",
      detail: assertion?.summary || `A fresh ${name} assertion is required.`,
      evidence: [],
    };
  }
  try {
    const evidence = await captureEvidence(root, assertion.evidence, notBefore, clock);
    return {
      name,
      status: "passed",
      detail: assertion.summary || `${name} verified`,
      evidence,
    };
  } catch (error) {
    return { name, status: "failed", detail: `${name} evidence is invalid: ${error.message}`, evidence: [] };
  }
}

export async function runEnvironmentPreflight(root, environment = "local", input = {}, clock = () => new Date()) {
  const started = Date.now();
  const { files, profile } = await loadEnvironmentProfile(root, environment);
  const scope = input.scope ?? "environment";
  assert(["environment", "project"].includes(scope), "INVALID_PREFLIGHT_SCOPE", "Preflight scope must be environment or project.");
  const projectOnly = scope === "project";
  const projectReason = String(input.reason ?? "").trim();
  if (projectOnly) assert(projectReason, "PREFLIGHT_REASON_REQUIRED", "Project-scoped preflight requires a reason.");
  if (input.persist !== false) await refreshExample(files, profile.credential_variables);
  const credentials = projectOnly
    ? await loadScanOnlyCredentials(root, profile.credential_variables)
    : await loadLocalCredentials(root, profile.credential_variables);
  const checks = [];
  const configuredWorkspace = path.resolve(files.root, profile.workspace || ".");
  checks.push({ name: "workspace", status: configuredWorkspace === files.root ? "passed" : "failed", detail: profile.workspace || "." });
  let packageMetadata = null;
  try { packageMetadata = JSON.parse(await readFile(path.join(files.root, "package.json"), "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const expectedProjectIds = [path.basename(files.root), packageMetadata?.name].filter(Boolean).map((value) => value.toLowerCase());
  checks.push({
    name: "project",
    status: expectedProjectIds.includes(String(profile.project_id || "").toLowerCase()) ? "passed" : "failed",
    detail: `configured ${profile.project_id || "missing"}; expected ${expectedProjectIds.join(" or ")}`,
  });
  checks.push({
    name: "start_command",
    status: profile.start_command ? "passed" : "failed",
    detail: profile.start_command || "missing start_command",
  });

  if (profile.application_version && profile.application_version !== "n/a") {
    const observed = packageMetadata?.version ?? "unknown";
    checks.push({ name: "application_version", status: observed === profile.application_version ? "passed" : "failed", detail: `expected ${profile.application_version}; observed ${observed}` });
  } else checks.push({ name: "application_version", status: "not_applicable", detail: "n/a" });

  if (projectOnly) {
    checks.push({ name: "services", status: "not_applicable", detail: projectReason });
    checks.push({ name: "entry_url", status: "not_applicable", detail: projectReason });
    checks.push({ name: "credential_variables", status: "not_applicable", detail: projectReason });
  } else {
    const urls = csv(profile.service_urls);
    for (const url of urls) {
      let parsed;
      try { parsed = new URL(url); } catch { parsed = null; }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        checks.push({ name: `service:${url}`, status: "failed", detail: "invalid HTTP(S) URL" });
        continue;
      }
      const result = await reachable(url, Number(input.timeoutMs ?? 3000));
      checks.push({ name: `service:${parsed.host}`, status: result.passed ? "passed" : "failed", detail: result.detail });
    }
    if (urls.length === 0) checks.push({ name: "services", status: "not_applicable", detail: "n/a" });

    if (profile.entry_url && profile.entry_url !== "n/a") {
      let valid = false;
      try { valid = ["http:", "https:"].includes(new URL(profile.entry_url).protocol); } catch {}
      checks.push({ name: "entry_url", status: valid ? "passed" : "failed", detail: valid ? profile.entry_url : "invalid URL" });
    } else checks.push({ name: "entry_url", status: "not_applicable", detail: "n/a" });
    checks.push({ name: "credential_variables", status: "passed", detail: `${Object.keys(credentials.values).length} runtime value(s) loaded and redacted` });
  }

  const applicable = (value) => Boolean(value && !["n/a", "none"].includes(String(value).toLowerCase()));
  checks.push(await assertionStatus(files.root, input.assertions, "login", !projectOnly && (applicable(profile.role) || Object.keys(credentials.values).length > 0), projectOnly ? projectReason : profile.role || "n/a", input.notBefore, clock));
  checks.push(await assertionStatus(files.root, input.assertions, "organization", !projectOnly && applicable(profile.organization), projectOnly ? projectReason : profile.organization || "n/a", input.notBefore, clock));
  checks.push(await assertionStatus(files.root, input.assertions, "integration", !projectOnly && applicable(profile.integration), projectOnly ? projectReason : profile.integration || "n/a", input.notBefore, clock));
  checks.push(await assertionStatus(files.root, input.assertions, "fixture", !projectOnly && applicable(profile.fixture), projectOnly ? projectReason : profile.fixture || "n/a", input.notBefore, clock));
  checks.push(await assertionStatus(files.root, input.assertions, "known_workarounds", !projectOnly && applicable(profile.known_workarounds) && profile.known_workarounds !== "none", projectOnly ? projectReason : profile.known_workarounds || "none", input.notBefore, clock));

  const now = isoNow(clock);
  const durationMs = Math.max(0, Date.now() - started);
  const budgetMs = Number(profile.discovery_budget_seconds || 300) * 1000;
  const warnings = durationMs > budgetMs ? [`Environment discovery exceeded ${profile.discovery_budget_seconds}s budget.`] : [];
  const redact = createRedactor(credentials.secretValues);
  const result = {
    schemaVersion: 1,
    environment: files.environment,
    scope,
    reason: projectOnly ? projectReason : null,
    profile: path.relative(files.root, files.profile),
    status: checks.some((check) => check.status === "failed") ? "failed" : "passed",
    checkedAt: now,
    durationMs,
    checks: checks.map((check) => ({ ...check, detail: redact(check.detail) })),
    warnings,
    credentialVariables: projectOnly ? [] : csv(profile.credential_variables),
  };
  if (result.status === "passed" && input.persist !== false) {
    profile.last_verified_at = now;
    profile.source = redact(input.source?.trim() || "automatic preflight");
    await atomicWrite(files.profile, renderFlatYaml(profile));
  }
  return { result, profile, credentials, files };
}

export async function scanEnvironmentArtifacts(root, secretValues) {
  const files = environmentFiles(root);
  const leaks = await scanFilesForSecrets(files.openatdd, secretValues, [files.dotenv]);
  for (const file of await filesBelow(files.openatdd)) {
    if (!/\.(?:json|ya?ml)$/i.test(file)) continue;
    const content = await readFile(file, "utf8");
    const pattern = /\.json$/i.test(file)
      ? /"(password|passwd|secret|token|api[_-]?key|private[_-]?key)"\s*:\s*"([^"]*)"/gi
      : /^(password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*:\s*["']?([^"'\n]*)["']?$/gim;
    for (const match of content.matchAll(pattern)) {
      const value = match[2].trim();
      if (value && value !== "[REDACTED]" && !/^[A-Z_][A-Z0-9_]*$/.test(value)) {
        leaks.push({ path: file, value: "[REDACTED]", reason: `secret-like key: ${match[1]}` });
        break;
      }
    }
  }
  return leaks;
}

export function resolveProfileLink(root, target) {
  if (/^https?:\/\//i.test(target)) return target;
  return resolveInside(root, target).relative;
}

export { csv as splitProfileList };

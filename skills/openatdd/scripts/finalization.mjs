import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assert,
  assertNoSecretValues,
  artifactLocator,
  atomicWrite,
  atomicWriteBatch,
  captureEvidence,
  createRedactor,
  inferHumanLanguage,
  isoNow,
  pathExists,
  readJson,
  resolveInside,
  scanFilesForSecrets,
  sha256,
  toPosix,
  verifyCapturedEvidence,
} from "./lib.mjs";
import {
  fingerprintProject,
  loadFinalizationManifest,
  resolveCommand,
  validateFinalizationManifest,
} from "./manifest.mjs";
import {
  loadEnvironmentProfile,
  loadLocalCredentials,
  loadScanOnlyCredentials,
  runEnvironmentPreflight,
} from "./profiles.mjs";
import { buildGraph } from "./graph.mjs";
import {
  DELIVERY_TERMINAL_PHASES,
  PHASES,
  advanceEpoch,
  assertContractIntegrity,
  evidenceBoundary,
  loadTask,
  projectFiles,
  readinessErrorsForState,
  renderTaskNotification,
  renderTaskReport,
  renderRequirementDocument,
  setPhase,
  taskFiles,
  validateHandoff,
  validateUatPlan,
} from "./workflow.mjs";

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function finalizedAcceptanceStatus(classification) {
  return classification === "AUTO" ? "passed" : "manual";
}

function finalizedAcceptanceSummary(criterion, prefix) {
  if (criterion?.classification === "ASSISTED") {
    return `${prefix} prepared evidence; explicit human judgment remains required.`;
  }
  if (criterion?.classification === "MANUAL") {
    return `${prefix} handed this criterion to human UAT.`;
  }
  return `${prefix} verified this automatic criterion.`;
}

function taskRelative(files, projectRelative) {
  if (String(projectRelative).startsWith("git:")) return String(projectRelative);
  const absolute = path.isAbsolute(projectRelative) ? projectRelative : path.join(files.root, projectRelative);
  return toPosix(path.relative(path.dirname(files.requirement), absolute));
}

async function profileDigest(root, environment) {
  const { files, profile } = await loadEnvironmentProfile(root, environment);
  return { files, profile, digest: sha256(await readFile(files.profile)) };
}

function baseEnvironment(credentials, command) {
  const names = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "NODE_PATH", ...(command.env ?? [])]);
  const environment = {};
  for (const name of names) {
    const value = credentials.values[name] ?? process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function executeCommand(root, commandInput, credentials, outputPath, metrics, clock = () => new Date()) {
  const command = resolveCommand(root, commandInput);
  assertNoSecretValues(JSON.stringify(command.argv), credentials.secretValues, `Command ${command.id}`);
  const redactor = createRedactor(credentials.secretValues);
  const startedAt = isoNow(clock);
  const start = Date.now();
  const maximum = 8 * 1024 * 1024;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timedOut = false;
  let overflow = false;
  let timer;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd,
      env: baseEnvironment(credentials, command),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > maximum) {
        overflow = true;
        child.kill("SIGTERM");
        return next.subarray(0, maximum);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", reject);
    child.on("close", resolve);
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, command.timeoutMs);
  }).finally(() => clearTimeout(timer));
  const endedAt = isoNow(clock);
  const durationMs = Math.max(0, Date.now() - start);
  metrics.commandInvocations += 1;
  metrics.cliInvocations += 1;
  metrics.commandDurationMs += durationMs;
  const stdoutText = redactor(stdout.toString("utf8"));
  const stderrText = redactor(stderr.toString("utf8"));
  const log = [
    `# Command: ${command.id}`,
    "",
    `- argv: ${command.argv.map((item) => JSON.stringify(redactor(item))).join(" ")}`,
    `- cwd: ${toPosix(path.relative(root, command.cwd)) || "."}`,
    `- started_at: ${startedAt}`,
    `- ended_at: ${endedAt}`,
    `- duration_ms: ${durationMs}`,
    `- exit_code: ${exitCode}`,
    `- timed_out: ${timedOut}`,
    `- output_overflow: ${overflow}`,
    "",
    "## stdout",
    "",
    stdoutText || "(empty)",
    "",
    "## stderr",
    "",
    stderrText || "(empty)",
    "",
  ].join("\n");
  assertNoSecretValues(log, credentials.secretValues, `Command log ${command.id}`);
  await atomicWrite(outputPath, log);
  metrics.evidenceWrites += 1;
  metrics.evidenceWritesByPhase[metrics.currentPhase] = (metrics.evidenceWritesByPhase[metrics.currentPhase] ?? 0) + 1;
  const passed = !timedOut && !overflow && command.expectedExitCodes.includes(exitCode);
  assert(passed, "FINALIZATION_COMMAND_FAILED", `Finalization command failed: ${command.id}`, {
    errors: [`exit=${exitCode}; timedOut=${timedOut}; overflow=${overflow}; evidence=${toPosix(path.relative(root, outputPath))}`],
  });
  return {
    id: command.id,
    argv: command.argv,
    contractSignature: commandSignature([commandInput]),
    evidenceSha256: sha256(log),
    durationMs,
    exitCode,
    evidencePath: artifactLocator(root, outputPath),
    stdout: stdoutText,
  };
}

const PREFLIGHT_ASSERTION_NAMES = new Set([
  "login",
  "organization",
  "integration",
  "fixture",
  "known_workarounds",
]);

function mergePreflightAssertions(base, generated) {
  return { ...(base ?? {}), ...generated };
}

async function executePreflightCommands(root, manifest, credentials, outputDirectory, metrics, clock) {
  const generated = {};
  for (const command of manifest.preflight?.commands ?? []) {
    const result = await executeCommand(
      root,
      command,
      credentials,
      path.join(outputDirectory, `preflight-${command.id}.md`),
      metrics,
      clock,
    );
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch (error) {
      assert(false, "INVALID_PREFLIGHT_ASSERTIONS", `Preflight command ${command.id} must print one JSON assertion object to stdout.`, {
        errors: [error.message],
      });
    }
    assert(payload && typeof payload === "object" && !Array.isArray(payload), "INVALID_PREFLIGHT_ASSERTIONS", `Preflight command ${command.id} returned a non-object payload.`);
    for (const [name, assertion] of Object.entries(payload)) {
      assert(PREFLIGHT_ASSERTION_NAMES.has(name), "INVALID_PREFLIGHT_ASSERTIONS", `Preflight command ${command.id} returned an unknown assertion: ${name}.`);
      assert(generated[name] === undefined, "INVALID_PREFLIGHT_ASSERTIONS", `Multiple preflight commands returned assertion ${name}.`);
      assert(assertion && typeof assertion === "object" && !Array.isArray(assertion), "INVALID_PREFLIGHT_ASSERTIONS", `Preflight assertion ${name} must be an object.`);
      assert(["passed", "failed"].includes(assertion.status), "INVALID_PREFLIGHT_ASSERTIONS", `Preflight assertion ${name} must report passed or failed.`);
      assert(typeof assertion.summary === "string" && assertion.summary.trim(), "INVALID_PREFLIGHT_ASSERTIONS", `Preflight assertion ${name} requires a concise summary.`);
      generated[name] = {
        status: assertion.status,
        summary: assertion.summary.trim(),
        evidence: result.evidencePath,
      };
    }
  }
  return generated;
}

function buildUatPlan(state, manifest) {
  const criteria = new Map(state.acceptance.items.map((item) => [item.id, item]));
  return {
    schemaVersion: 1,
    environment: manifest.environment,
    entryUrl: null,
    batches: manifest.uat.batches.map((batch) => ({
      id: batch.id,
      name: batch.name,
      runner: batch.runner === "internal" ? "internal" : "command",
      reuseSession: batch.reuseSession !== false,
      steps: batch.acceptanceIds.map((acceptanceId, index) => ({
        id: `${acceptanceId.toLowerCase()}-${index + 1}`,
        acceptanceId,
        action: criteria.get(acceptanceId)?.when ?? `Verify ${acceptanceId}`,
        expected: criteria.get(acceptanceId)?.then ?? `${acceptanceId} passes`,
        checkpoint: index === batch.acceptanceIds.length - 1,
      })),
    })),
    estimatedRoundTrips: Number(manifest.uat.estimatedRoundTrips ?? manifest.uat.batches.length * 2),
    failureRecovery: "Repair preview failures before freeze; after freeze, use the issue flow and rerun one complete finalization.",
  };
}

async function detectedVersion(root) {
  try { return (await readJson(path.join(root, "package.json"))).version ?? "unspecified"; } catch { return "unspecified"; }
}

async function buildHandoff(root, state, files, manifest, profile, evidenceReferences, reportName, manifestPath) {
  const language = inferHumanLanguage(await readFile(files.requirement, "utf8"), state.requirement);
  const zh = language === "zh-CN";
  const links = [
    { label: zh ? "唯一需求交付文档" : "Single requirement delivery document", target: path.basename(files.requirement), applicable: true },
    { label: `${manifest.environment} ${zh ? "环境档案" : "environment profile"}`, target: taskRelative(files, `.openatdd/environments/${manifest.environment}.yaml`), applicable: true },
    { label: zh ? "Finalization 清单" : "Finalization manifest", target: taskRelative(files, manifestPath), applicable: true },
  ];
  for (const link of manifest.links ?? []) links.push(link);
  const readme = path.join(root, "README.md");
  links.push(await pathExists(readme)
    ? { label: zh ? "项目文档" : "Project documentation", target: taskRelative(files, "README.md"), applicable: true }
    : { label: zh ? "项目文档" : "Project documentation", target: null, applicable: false, reason: zh ? "项目没有 README.md。" : "README.md is absent." });
  for (const [acceptanceId, captured] of evidenceReferences) {
    for (const item of captured) links.push({
      label: `${acceptanceId} ${zh ? "证据" : "evidence"}: ${path.basename(item.path)}`,
      target: item.path,
      applicable: true,
    });
  }
  const credentialNames = String(profile.credential_variables ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    schemaVersion: 1,
    taskId: state.taskId,
    preparedAt: isoNow(),
    context: {
      language,
      version: await detectedVersion(root),
      environment: manifest.environment,
      role: profile.role || "n/a",
      prerequisites: [profile.start_command && profile.start_command !== "n/a"
        ? `${zh ? "启动或验证命令" : "Start or verify with"}: ${profile.start_command}`
        : (zh ? "使用已验证的项目工作区。" : "Use the verified project workspace.")],
      accountReference: credentialNames.length ? credentialNames.join(", ") : "n/a (no login required)",
      entryPoint: profile.entry_url && profile.entry_url !== "n/a" ? profile.entry_url : `${zh ? "打开" : "Open"} ${reportName}${zh ? "。" : "."}`,
      estimatedMinutes: Number(manifest.handoff?.estimatedMinutes ?? Math.max(5, state.acceptance.items.length * 2)),
    },
    steps: state.acceptance.items.map((criterion, index) => ({
      number: index + 1,
      acceptanceId: criterion.id,
      title: criterion.title,
      precondition: criterion.given,
      action: criterion.when,
      expected: criterion.then,
      checkbox: "[ ] Pass  [ ] Fail",
      evidence: (evidenceReferences.get(criterion.id) ?? []).map((item) => item.path),
      judgment: criterion.classification === "AUTO"
        ? (zh ? "确认准备的证据与可观察结果。" : "Confirm prepared evidence and observable result.")
        : (zh ? "此项需要人工判断。" : "A person must make this judgment."),
    })),
    links,
  };
}

async function verifyHttpLinks(links, timeoutMs, metrics) {
  const errors = [];
  for (const link of links.filter((item) => item.applicable !== false && /^https?:\/\//i.test(item.target ?? ""))) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(link.target, { method: "HEAD", signal: controller.signal, redirect: "follow" });
      metrics.linkChecks += 1;
      if (response.status >= 400) errors.push(`${link.label}: HTTP ${response.status}`);
    } catch (error) {
      errors.push(`${link.label}: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return errors;
}

function initialMetrics(mode, clock) {
  return {
    mode,
    startedAt: isoNow(clock),
    wallTimeMs: 0,
    dryRunRuns: mode === "dry-run" ? 1 : 0,
    finalRuns: mode === "final" ? 1 : 0,
    commandInvocations: 0,
    cliInvocations: 0,
    commandDurationMs: 0,
    checkGroupRuns: { focused: 0, module: 0, broad: 0 },
    uatJourneyRuns: 0,
    uatBatchRuns: 0,
    browserRoundTrips: 0,
    affectedHistoryPasses: 0,
    historyRuns: 0,
    historyCacheHits: 0,
    historyEpochReuse: 0,
    skippedCheckGroups: [],
    checkGroupSignatureReuse: [],
    rehearsalEvidenceReuse: [],
    rehearsalCommandInvocations: 0,
    evidenceWrites: 0,
    evidenceWritesByPhase: {},
    phaseDurationsMs: {},
    linkChecks: 0,
    warnings: [],
    currentPhase: "setup",
  };
}

function beginMetricsPhase(metrics, phase) {
  metrics.currentPhase = phase;
  return Date.now();
}

function endMetricsPhase(metrics, phase, startedAt) {
  metrics.phaseDurationsMs[phase] = (metrics.phaseDurationsMs[phase] ?? 0) + Math.max(0, Date.now() - startedAt);
}

function finishMetrics(metrics) {
  delete metrics.currentPhase;
  return metrics;
}

function applyBudgets(metrics, budgets = {}) {
  const comparisons = [
    ["wallTimeMs", metrics.wallTimeMs],
    ["commandInvocations", metrics.commandInvocations],
    ["browserRoundTrips", metrics.browserRoundTrips],
    ["evidenceWrites", metrics.evidenceWrites],
  ];
  for (const [name, observed] of comparisons) {
    if (budgets[name] !== undefined && observed > Number(budgets[name])) metrics.warnings.push(`${name} ${observed} exceeded budget ${budgets[name]}.`);
  }
  return metrics;
}

async function loadContext(root, taskId, input) {
  const inspected = await inspectFinalization(root, taskId, input);
  const { loaded, manifestInfo, validation } = inspected;
  assert([PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, ...DELIVERY_TERMINAL_PHASES].includes(loaded.state.phase), "INVALID_PHASE", `Finalization is not allowed in phase ${loaded.state.phase}.`);
  assert(validation.valid, "INVALID_FINALIZATION_MANIFEST", "Finalization manifest is invalid.", { errors: validation.errors });
  const profileInfo = await profileDigest(root, manifestInfo.manifest.environment);
  const credentials = manifestInfo.manifest.preflight?.scope === "project"
    ? await loadScanOnlyCredentials(root, profileInfo.profile.credential_variables)
    : await loadLocalCredentials(root, profileInfo.profile.credential_variables);
  return { ...loaded, manifestInfo, profileInfo, credentials, warnings: validation.warnings };
}

async function inspectFinalization(root, taskId, input = {}) {
  const loaded = await loadTask(root, taskId);
  await assertContractIntegrity(loaded.files, loaded.state);
  const manifestInfo = await loadFinalizationManifest(root, taskId, input.manifest);
  const validation = validateFinalizationManifest(manifestInfo.manifest, loaded.state.acceptance.items);
  return { loaded, manifestInfo, validation };
}

export async function validateFinalizationPlan(root, taskId, input = {}) {
  const { loaded, manifestInfo, validation } = await inspectFinalization(root, taskId, input);
  return {
    schemaVersion: 1,
    taskId,
    phase: loaded.state.phase,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    manifestPath: manifestInfo.relativePath,
    manifestDigest: manifestInfo.digest,
    preflight: {
      scope: manifestInfo.manifest.preflight?.scope ?? "environment",
      reason: manifestInfo.manifest.preflight?.reason ?? null,
    },
  };
}

async function finalizationUnchanged(root, taskId, input = {}) {
  const { loaded, manifestInfo } = await inspectFinalization(root, taskId, input);
  if (loaded.state.finalization?.status !== "complete") return false;
  if (loaded.state.finalization.manifestDigest !== manifestInfo.digest) return false;
  if (!(await pathExists(loaded.files.finalizeResult))) return false;
  const inventory = await fingerprintProject(root, manifestInfo.manifest.source);
  return loaded.state.finalization.sourceFingerprint === inventory.fingerprint;
}

export async function dryRunFinalization(root, taskId, input = {}, clock = () => new Date()) {
  const wallStart = Date.now();
  const context = await loadContext(root, taskId, input);
  const { state, files, manifestInfo, profileInfo, credentials } = context;
  const originalState = await readFile(files.state);
  const inventory = await fingerprintProject(root, manifestInfo.manifest.source);
  const metrics = initialMetrics("dry-run", clock);
  const previewDirectory = path.join(files.task, "preview");
  await mkdir(previewDirectory, { recursive: true });
  const commandResults = [];
  const verificationStartedAt = input.verificationStartedAt ?? isoNow(clock);
  let status = "passed";
  const errors = [];
  try {
    let phaseStarted = beginMetricsPhase(metrics, "preflight");
    const generatedBoundary = isoNow(clock);
    const generatedAssertions = await executePreflightCommands(
      root,
      manifestInfo.manifest,
      credentials,
      previewDirectory,
      metrics,
      clock,
    );
    const hasGeneratedAssertions = (manifestInfo.manifest.preflight?.commands?.length ?? 0) > 0;
    const preflight = await runEnvironmentPreflight(root, manifestInfo.manifest.environment, {
      assertions: mergePreflightAssertions(input.assertions, generatedAssertions),
      timeoutMs: input.timeoutMs,
      persist: false,
      notBefore: hasGeneratedAssertions ? generatedBoundary : evidenceBoundary(state),
      scope: manifestInfo.manifest.preflight?.scope,
      reason: manifestInfo.manifest.preflight?.reason,
    }, clock);
    assert(preflight.result.status === "passed", "PREFLIGHT_FAILED", "Dry-run environment preflight failed.", {
      errors: preflight.result.checks.filter((item) => item.status === "failed").map((item) => `${item.name}: ${item.detail}`),
    });
    endMetricsPhase(metrics, "preflight", phaseStarted);
    phaseStarted = beginMetricsPhase(metrics, "entry-points");
    for (const command of manifestInfo.manifest.dryRun.commands) {
      const target = path.join(previewDirectory, `${command.id}.md`);
      commandResults.push(await executeCommand(root, command, credentials, target, metrics, clock));
    }
    endMetricsPhase(metrics, "entry-points", phaseStarted);
    phaseStarted = beginMetricsPhase(metrics, "handoff-preview");
    const plan = buildUatPlan(state, manifestInfo.manifest);
    const planValidation = validateUatPlan(state, plan);
    assert(planValidation.valid, "INVALID_UAT_PLAN", "Dry-run UAT coverage is invalid.", { errors: planValidation.errors });
    const previewState = structuredClone(state);
    previewState.preflight = preflight.result;
    previewState.uat = { planStatus: "planned", batches: {}, warnings: [], estimatedRoundTrips: plan.estimatedRoundTrips };
    const emptyEvidence = new Map(state.acceptance.items.map((item) => [item.id, []]));
    const handoff = await buildHandoff(root, previewState, files, manifestInfo.manifest, profileInfo.profile, emptyEvidence, path.basename(files.requirement), manifestInfo.relativePath);
    const previewReport = renderTaskReport(previewState, handoff);
    assertNoSecretValues(previewReport, credentials.secretValues, "Preview report");
    await atomicWrite(files.previewReport, previewReport);
    const handoffValidation = await validateHandoff(previewState, handoff, files);
    assert(handoffValidation.valid, "INVALID_HANDOFF", "Dry-run handoff preview is invalid.", { errors: handoffValidation.errors });
    const httpErrors = manifestInfo.manifest.dryRun.checkHttpLinks === false
      ? []
      : await verifyHttpLinks(handoff.links, Number(manifestInfo.manifest.dryRun.linkTimeoutMs ?? 3000), metrics);
    assert(httpErrors.length === 0, "INVALID_HANDOFF_LINK", "Dry-run found invalid HTTP links.", { errors: httpErrors });
    const leaks = await scanFilesForSecrets(previewDirectory, credentials.secretValues);
    assert(leaks.length === 0, "SECRET_LEAK", "Dry-run preview contains a loaded credential value.", { errors: leaks.map((item) => item.path) });
    endMetricsPhase(metrics, "handoff-preview", phaseStarted);
    phaseStarted = beginMetricsPhase(metrics, "source-stability");
    const after = await fingerprintProject(root, manifestInfo.manifest.source);
    assert(after.fingerprint === inventory.fingerprint, "SOURCE_CHANGED_DURING_DRY_RUN", "Source changed during finalize --dry-run.");
    endMetricsPhase(metrics, "source-stability", phaseStarted);
  } catch (error) {
    status = "failed";
    errors.push(error.message, ...(error?.details?.errors ?? []));
  }
  metrics.wallTimeMs = Math.max(0, Date.now() - wallStart);
  applyBudgets(metrics, manifestInfo.manifest.budgets);
  finishMetrics(metrics);
  const preview = {
    schemaVersion: 1,
    taskId,
    status,
    createdAt: isoNow(clock),
    candidateFingerprint: inventory.fingerprint,
    inventoryCount: inventory.count,
    candidateFiles: inventory.files,
    manifestPath: manifestInfo.relativePath,
    manifestDigest: manifestInfo.digest,
    profileDigest: profileInfo.digest,
    verificationStartedAt,
    commandResults,
    metrics,
    errors,
  };
  await atomicWrite(files.finalizePreview, json(preview));
  const unchangedState = Buffer.compare(originalState, await readFile(files.state)) === 0;
  assert(unchangedState, "DRY_RUN_MUTATED_STATE", "finalize --dry-run changed formal task state.");
  assert(status === "passed", "FINALIZATION_DRY_RUN_FAILED", "Finalization dry-run failed.", { errors });
  return { state, files, preview, manifest: manifestInfo.manifest, unchangedState };
}

async function capturePaths(root, paths, boundary, clock) {
  return captureEvidence(root, paths, boundary, clock);
}

function evidenceForReferences(referenceEvidence, references) {
  const values = [];
  for (const reference of references) values.push(...(referenceEvidence.get(reference) ?? []));
  return [...new Map(values.map((item) => [item.path, item])).values()];
}

function commandSignature(commands = []) {
  if (commands.length === 0 || commands.some((command) => command.deterministic !== true)) return null;
  return JSON.stringify(commands.map((command) => ({
    argv: command.argv,
    cwd: command.cwd ?? null,
    env: [...(command.env ?? [])].sort(),
    timeoutMs: command.timeoutMs ?? null,
    expectedExitCodes: [...(command.expectedExitCodes ?? [0])].sort((a, b) => a - b),
  })));
}

function reusableRehearsalEvidence(preview, commands) {
  const signature = commandSignature(commands);
  if (!signature || !preview?.verificationStartedAt) return null;
  const available = [...(preview.commandResults ?? [])];
  const results = [];
  for (const command of commands) {
    const commandContract = commandSignature([command]);
    const index = available.findIndex((item) => item.contractSignature === commandContract
      && item.evidencePath
      && item.evidenceSha256);
    if (index === -1) return null;
    results.push(available.splice(index, 1)[0]);
  }
  return { signature, results };
}

async function captureReusableRehearsalEvidence(root, reuse, boundary, clock) {
  try {
    const evidence = await capturePaths(root, reuse.results.map((item) => item.evidencePath), boundary, clock);
    if (evidence.length !== reuse.results.length) return null;
    if (evidence.some((item, index) => item.sha256 !== reuse.results[index].evidenceSha256)) return null;
    return evidence;
  } catch (error) {
    if (["EVIDENCE_NOT_FOUND", "INVALID_EVIDENCE", "STALE_EVIDENCE"].includes(error?.code)) return null;
    throw error;
  }
}

/**
 * Reuse evidence already produced in this verification epoch only when every
 * command explicitly declares deterministic execution and the full execution
 * contract matches. Unmarked commands may observe time, external state, or
 * side effects and must run independently even when their argv is identical.
 */
function reusableEpochEvidence(manifest, referenceEvidence, replayCommands) {
  const signature = commandSignature(replayCommands);
  if (!signature) return null;
  const candidates = [
    ...(manifest.checks ?? []).map((group) => [`check:${group.id}`, group.commands]),
    ...(manifest.uat?.batches ?? []).map((batch) => [`batch:${batch.id}`, batch.runner === "internal" ? [] : batch.commands]),
  ];
  for (const [reference, commands] of candidates) {
    if (commandSignature(commands) !== signature) continue;
    const evidence = referenceEvidence.get(reference);
    if (evidence?.length) return { reference, evidence };
  }
  return null;
}

async function projectHistoricalStates(root, state, manifest, referenceEvidence, fingerprint, boundary, clock, metrics) {
  const dependencyStates = new Map();
  const project = projectFiles(root);
  const index = await pathExists(project.reverificationIndex)
    ? await readJson(project.reverificationIndex)
    : { schemaVersion: 1, entries: [] };
  const nextEntries = [...index.entries];
  for (const dependency of state.affectedDependencies) {
    const prior = await loadTask(root, dependency.taskId);
    const override = (manifest.history.overrides ?? []).find((item) => item.taskId === dependency.taskId);
    let snapshot = null;
    if (!override && await pathExists(prior.files.finalizationSnapshot)) snapshot = await readJson(prior.files.finalizationSnapshot);
    assert(override || snapshot, "HISTORY_REPLAY_REQUIRED", `Affected task ${dependency.taskId} requires a finalization snapshot or explicit history override.`);
    const contractDigest = sha256(`${prior.state.acceptance.sha256}\n${prior.state.solution.sha256}`);
    const replayDigest = sha256(JSON.stringify(override ?? snapshot.replay));
    const key = sha256(`${dependency.taskId}\n${contractDigest}\n${replayDigest}\n${fingerprint}`);
    const cached = nextEntries.find((item) => item.key === key);
    const reused = override ? null : reusableEpochEvidence(manifest, referenceEvidence, snapshot.replay.commands);
    let evidence;
    if (cached && (await verifyCapturedEvidence(root, cached.evidence, dependency.notBefore)).length === 0) {
      evidence = cached.evidence;
      metrics.historyCacheHits += 1;
    } else if (override) {
      evidence = evidenceForReferences(referenceEvidence, override.evidenceFrom);
      assert(evidence.length > 0, "HISTORY_EVIDENCE_REQUIRED", `History override for ${dependency.taskId} resolved no evidence.`);
      metrics.historyRuns += 1;
    } else if (reused) {
      evidence = reused.evidence;
      metrics.historyEpochReuse += 1;
    } else {
      const paths = [];
      const credentials = await loadLocalCredentials(root, "");
      // History evidence is immutable per frozen source fingerprint. A repaired
      // task may formalize more than once; reusing the old directory would
      // overwrite evidence still referenced by unaffected historical checks.
      const directory = path.join(taskFiles(root, state.taskId).evidence, "finalize", `fingerprint-${fingerprint}`, `history-${dependency.taskId}`);
      await mkdir(directory, { recursive: true });
      for (const command of snapshot.replay.commands) {
        const result = await executeCommand(root, command, credentials, path.join(directory, `${command.id}.md`), metrics, clock);
        paths.push(result.evidencePath);
      }
      evidence = await capturePaths(root, paths, boundary, clock);
      metrics.historyRuns += 1;
    }
    const acceptanceIds = override?.acceptanceIds ?? snapshot.replay.acceptanceIds;
    for (const acceptanceId of dependency.acceptanceIds) assert(acceptanceIds.includes(acceptanceId), "HISTORY_MAPPING_INCOMPLETE", `History replay for ${dependency.taskId} does not map ${acceptanceId}.`);
    const projected = structuredClone(prior.state);
    const now = isoNow(clock);
    for (const acceptanceId of dependency.acceptanceIds) {
      const criterion = projected.acceptance.items.find((item) => item.id === acceptanceId);
      projected.results[acceptanceId] = {
        acceptanceId,
        classification: criterion?.classification ?? "AUTO",
        blocking: criterion?.blocking ?? true,
        status: finalizedAcceptanceStatus(criterion?.classification ?? "AUTO"),
        summary: finalizedAcceptanceSummary(criterion, `Reverified once for final fingerprint ${fingerprint}:`),
        evidence,
        verifiedAt: now,
        epoch: projected.verification.epoch,
      };
    }
    for (const check of Object.values(projected.checks)) {
      const evidenceInvalid = check.status === "passed"
        && (await verifyCapturedEvidence(root, check.evidence ?? [], dependency.notBefore)).length > 0;
      if (check.status === "affected" || evidenceInvalid) {
        Object.assign(check, { status: "passed", evidence, verifiedAt: now, epoch: projected.verification.epoch, sourceFingerprint: fingerprint });
      }
    }
    projected.checks[`finalize-${state.taskId}`] = {
      id: `finalize-${state.taskId}`,
      name: `finalization reverification for ${state.taskId}`,
      command: "manifest history replay",
      status: "passed",
      scope: "broad",
      sourceFingerprint: fingerprint,
      durationMs: null,
      summary: "Batched once after final source freeze.",
      evidence,
      verifiedAt: now,
      epoch: projected.verification.epoch,
    };
    projected.phase = PHASES.DELIVERED;
    projected.readyAt = now;
    projected.updatedAt = now;
    dependencyStates.set(dependency.taskId, { state: projected, files: prior.files });
    if (!cached) {
      // An entry for the same contract and replay under an older fingerprint can
      // never be reused again; keeping it would grow the index without bound.
      for (let position = nextEntries.length - 1; position >= 0; position -= 1) {
        const entry = nextEntries[position];
        if (entry.taskId === dependency.taskId
          && entry.contractDigest === contractDigest
          && entry.replayDigest === replayDigest
          && entry.fingerprint !== fingerprint) {
          nextEntries.splice(position, 1);
        }
      }
      nextEntries.push({ key, taskId: dependency.taskId, contractDigest, replayDigest, fingerprint, evidence, verifiedAt: now });
    }
  }
  return { dependencyStates, index: { schemaVersion: 1, entries: nextEntries } };
}

export async function finalizeTask(root, taskId, input = {}, clock = () => new Date()) {
  const wallStart = Date.now();
  const context = await loadContext(root, taskId, input);
  const { state, files, manifestInfo, profileInfo, credentials } = context;
  const inventory = await fingerprintProject(root, manifestInfo.manifest.source);
  if (state.finalization?.status === "complete"
    && state.finalization.sourceFingerprint === inventory.fingerprint
    && state.finalization.manifestDigest === manifestInfo.digest) {
    return { state, files, result: await readJson(files.finalizeResult), unchanged: true };
  }
  assert(await pathExists(files.finalizePreview), "FINALIZATION_PREVIEW_REQUIRED", "Run finalize --dry-run before formal finalization.");
  const preview = await readJson(files.finalizePreview);
  assert(preview.status === "passed", "FINALIZATION_PREVIEW_FAILED", "The latest finalization preview did not pass.");
  const previewFiles = new Map((preview.candidateFiles ?? []).map((item) => [item.path, item]));
  const currentFiles = new Map(inventory.files.map((item) => [item.path, item]));
  const previewDrift = [...new Set([...previewFiles.keys(), ...currentFiles.keys()])].filter(
    (file) => JSON.stringify(previewFiles.get(file)) !== JSON.stringify(currentFiles.get(file)),
  );
  assert(preview.candidateFingerprint === inventory.fingerprint, "FINALIZATION_PREVIEW_STALE", "Source changed after finalize --dry-run.", {
    errors: previewDrift.map((file) => `${file}: ${JSON.stringify(previewFiles.get(file))} -> ${JSON.stringify(currentFiles.get(file))}`),
  });
  assert(preview.manifestDigest === manifestInfo.digest, "FINALIZATION_PREVIEW_STALE", "Manifest changed after finalize --dry-run.");
  assert(preview.profileDigest === profileInfo.digest, "FINALIZATION_PREVIEW_STALE", "Environment profile changed after finalize --dry-run.");
  assert(!state.issues.some((issue) => issue.status === "open"), "OPEN_ISSUE_BLOCKS_FINALIZE", "Resolve open issues before formal finalization.");

  const metrics = initialMetrics("final", clock);
  metrics.dryRunRuns = Number(preview.metrics?.dryRunRuns ?? 1);
  metrics.rehearsalCommandInvocations = Number(preview.metrics?.commandInvocations ?? 0);
  const previousBoundary = evidenceBoundary(state);
  const now = isoNow(clock);
  const draft = structuredClone(state);
  advanceEpoch(draft, now, `final source frozen: ${inventory.fingerprint}`);
  draft.results = {};
  draft.checks = {};
  draft.checkSequence = [];
  draft.readyAt = null;
  draft.sourceFingerprint = inventory.fingerprint;
  draft.finalization = { status: "running", version: 1, startedAt: now, sourceFingerprint: inventory.fingerprint, manifestDigest: manifestInfo.digest };
  setPhase(draft, PHASES.PRE_UAT, now);
  const boundary = draft.verification.startedAt;
  const runDirectory = path.join(files.evidence, "finalize", `epoch-${draft.verification.epoch}`);
  await mkdir(runDirectory, { recursive: true });

  let phaseStarted = beginMetricsPhase(metrics, "preflight");
  const generatedAssertions = await executePreflightCommands(
    root,
    manifestInfo.manifest,
    credentials,
    runDirectory,
    metrics,
    clock,
  );
  const hasGeneratedAssertions = (manifestInfo.manifest.preflight?.commands?.length ?? 0) > 0;
  const preflight = await runEnvironmentPreflight(root, manifestInfo.manifest.environment, {
    assertions: mergePreflightAssertions(input.assertions, generatedAssertions),
    timeoutMs: input.timeoutMs,
    persist: false,
    notBefore: hasGeneratedAssertions ? boundary : previousBoundary,
    scope: manifestInfo.manifest.preflight?.scope,
    reason: manifestInfo.manifest.preflight?.reason,
  }, clock);
  assert(preflight.result.status === "passed", "PREFLIGHT_FAILED", "Final environment preflight failed.", {
    errors: preflight.result.checks.filter((item) => item.status === "failed").map((item) => `${item.name}: ${item.detail}`),
  });
  endMetricsPhase(metrics, "preflight", phaseStarted);
  draft.preflight = preflight.result;
  const referenceEvidence = new Map();

  phaseStarted = beginMetricsPhase(metrics, "checks");
  const requiredReferences = new Set([
    ...Object.values(manifestInfo.manifest.acceptance ?? {}).flat(),
    ...(manifestInfo.manifest.history?.overrides ?? []).flatMap((item) => item.evidenceFrom ?? []),
  ]);
  const executedCheckGroups = new Map();
  for (const group of manifestInfo.manifest.checks) {
    // A Quick task has already run its focused checks during implementation. Once
    // the source is frozen, a narrower group that maps to no acceptance evidence
    // only repeats what the single broad group already covers.
    if (draft.routing?.lane === "quick" && group.scope !== "broad" && !requiredReferences.has(`check:${group.id}`)) {
      metrics.skippedCheckGroups.push(group.id);
      continue;
    }
    const rehearsalReuse = draft.routing?.lane === "quick"
      ? reusableRehearsalEvidence(preview, group.commands)
      : null;
    const rehearsalEvidence = rehearsalReuse
      ? await captureReusableRehearsalEvidence(root, rehearsalReuse, preview.verificationStartedAt, clock)
      : null;
    if (rehearsalEvidence) {
      const verifiedAt = isoNow(clock);
      metrics.rehearsalEvidenceReuse.push(group.id);
      metrics.checkGroupRuns[group.scope] += 1;
      referenceEvidence.set(`check:${group.id}`, rehearsalEvidence);
      draft.checks[group.id] = {
        id: group.id,
        name: group.name || group.id,
        command: group.commands.map((item) => item.argv.join(" ")).join(" && "),
        status: "passed",
        scope: group.scope,
        sourceFingerprint: inventory.fingerprint,
        durationMs: rehearsalReuse.results.reduce((sum, item) => sum + Number(item.durationMs ?? 0), 0),
        summary: `Final ${group.scope} group reused exact deterministic rehearsal evidence.`,
        evidence: rehearsalEvidence,
        verifiedAt,
        epoch: draft.verification.epoch,
      };
      draft.checkSequence.push({ id: group.id, scope: group.scope, status: "passed", sourceFingerprint: inventory.fingerprint, verifiedAt, epoch: draft.verification.epoch });
      continue;
    }
    const signature = commandSignature(group.commands);
    const identical = group.scope === "broad" || !signature ? undefined : executedCheckGroups.get(signature);
    if (identical) {
      // Explicitly deterministic commands with an identical execution contract
      // may reuse evidence. The broad group is exempt: exactly one broad
      // execution backs the frozen journey and history replay snapshot.
      metrics.checkGroupSignatureReuse.push(group.id);
      const evidence = referenceEvidence.get(identical.reference);
      const verifiedAt = isoNow(clock);
      referenceEvidence.set(`check:${group.id}`, evidence);
      draft.checks[group.id] = {
        id: group.id,
        name: group.name || group.id,
        command: group.commands.map((item) => item.argv.join(" ")).join(" && "),
        status: "passed",
        scope: group.scope,
        sourceFingerprint: inventory.fingerprint,
        durationMs: 0,
        summary: `Final ${group.scope} group reused the identical command evidence of ${identical.id}.`,
        evidence,
        verifiedAt,
        epoch: draft.verification.epoch,
      };
      draft.checkSequence.push({ id: group.id, scope: group.scope, status: "passed", sourceFingerprint: inventory.fingerprint, verifiedAt, epoch: draft.verification.epoch });
      continue;
    }
    metrics.checkGroupRuns[group.scope] += 1;
    const paths = [];
    let durationMs = 0;
    for (const command of group.commands) {
      const result = await executeCommand(root, command, credentials, path.join(runDirectory, `check-${group.id}-${command.id}.md`), metrics, clock);
      paths.push(result.evidencePath);
      durationMs += result.durationMs;
    }
    const evidence = await capturePaths(root, paths, boundary, clock);
    referenceEvidence.set(`check:${group.id}`, evidence);
    if (signature) executedCheckGroups.set(signature, { id: group.id, reference: `check:${group.id}` });
    draft.checks[group.id] = {
      id: group.id,
      name: group.name || group.id,
      command: group.commands.map((item) => item.argv.join(" ")).join(" && "),
      status: "passed",
      scope: group.scope,
      sourceFingerprint: inventory.fingerprint,
      durationMs,
      summary: `Final ${group.scope} group passed.`,
      evidence,
      verifiedAt: isoNow(clock),
      epoch: draft.verification.epoch,
    };
    draft.checkSequence.push({ id: group.id, scope: group.scope, status: "passed", sourceFingerprint: inventory.fingerprint, verifiedAt: draft.checks[group.id].verifiedAt, epoch: draft.verification.epoch });
  }
  endMetricsPhase(metrics, "checks", phaseStarted);

  phaseStarted = beginMetricsPhase(metrics, "uat");
  const plan = buildUatPlan(draft, manifestInfo.manifest);
  const planValidation = validateUatPlan(draft, plan);
  assert(planValidation.valid, "INVALID_UAT_PLAN", "Final UAT plan is invalid.", { errors: planValidation.errors });
  draft.uat = { planStatus: "planned", plannedAt: isoNow(clock), batches: {}, warnings: [], estimatedRoundTrips: plan.estimatedRoundTrips };
  const executedJourney = manifestInfo.manifest.uat.batches.some((batch) => batch.runner !== "internal");
  metrics.uatJourneyRuns = executedJourney ? 1 : 0;
  metrics.browserRoundTrips = plan.estimatedRoundTrips;
  for (const batch of manifestInfo.manifest.uat.batches) {
    const paths = [];
    if (batch.runner === "internal") {
      const target = path.join(runDirectory, `batch-${batch.id}-internal.md`);
      await atomicWrite(target, `# Manual UAT handoff: ${batch.name}\n\nNo automatic UAT journey was executed for this batch.\n\nCovered acceptance: ${batch.acceptanceIds.join(", ")}\nSource fingerprint: ${inventory.fingerprint}\nRequired outcome: a person must judge the approved journey.\n`);
      metrics.evidenceWrites += 1;
      metrics.evidenceWritesByPhase.uat = (metrics.evidenceWritesByPhase.uat ?? 0) + 1;
      paths.push(artifactLocator(root, target));
    } else {
      for (const command of batch.commands) {
        const result = await executeCommand(root, command, credentials, path.join(runDirectory, `batch-${batch.id}-${command.id}.md`), metrics, clock);
        paths.push(result.evidencePath);
      }
    }
    const evidence = await capturePaths(root, paths, boundary, clock);
    referenceEvidence.set(`batch:${batch.id}`, evidence);
    const status = batch.runner === "internal" ? "manual" : "passed";
    draft.uat.batches[batch.id] = {
      id: batch.id,
      status,
      summary: batch.runner === "internal"
        ? `${batch.name} requires explicit human judgment; no automatic journey was executed.`
        : `${batch.name} passed.`,
      evidence,
      verifiedAt: isoNow(clock),
      epoch: draft.verification.epoch,
    };
    metrics.uatBatchRuns += 1;
  }
  endMetricsPhase(metrics, "uat", phaseStarted);

  phaseStarted = beginMetricsPhase(metrics, "acceptance-mapping");
  const acceptanceEvidence = new Map();
  for (const criterion of draft.acceptance.items) {
    const evidence = evidenceForReferences(referenceEvidence, manifestInfo.manifest.acceptance[criterion.id]);
    assert(evidence.length > 0, "ACCEPTANCE_EVIDENCE_REQUIRED", `${criterion.id} resolved no final evidence.`);
    acceptanceEvidence.set(criterion.id, evidence);
    draft.results[criterion.id] = {
      acceptanceId: criterion.id,
      classification: criterion.classification,
      blocking: criterion.blocking,
      status: finalizedAcceptanceStatus(criterion.classification),
      summary: finalizedAcceptanceSummary(criterion, `Finalization manifest for ${criterion.id}`),
      evidence,
      verifiedAt: isoNow(clock),
      epoch: draft.verification.epoch,
    };
  }
  endMetricsPhase(metrics, "acceptance-mapping", phaseStarted);

  phaseStarted = beginMetricsPhase(metrics, "history");
  metrics.affectedHistoryPasses = draft.affectedDependencies.length > 0 ? 1 : 0;
  const history = await projectHistoricalStates(root, draft, manifestInfo.manifest, referenceEvidence, inventory.fingerprint, boundary, clock, metrics);
  endMetricsPhase(metrics, "history", phaseStarted);
  phaseStarted = beginMetricsPhase(metrics, "handoff-readiness");
  const handoff = await buildHandoff(root, draft, files, manifestInfo.manifest, profileInfo.profile, acceptanceEvidence, path.basename(files.requirement), manifestInfo.relativePath);
  draft.handoff = { status: "prepared", preparedAt: handoff.preparedAt, estimatedMinutes: handoff.context.estimatedMinutes };
  const handoffValidation = await validateHandoff(draft, handoff, files);
  assert(handoffValidation.valid, "INVALID_HANDOFF", "Final handoff is invalid.", { errors: handoffValidation.errors });
  const beforeCommit = await fingerprintProject(root, manifestInfo.manifest.source);
  assert(beforeCommit.fingerprint === inventory.fingerprint, "SOURCE_CHANGED_DURING_FINALIZE", "Source changed during formal finalization.");

  const readiness = await readinessErrorsForState(root, draft, files, { dependencyStates: history.dependencyStates, handoff });
  assert(readiness.length === 0, "READINESS_BLOCKED", "Projected finalization is not ready.", { errors: readiness });
  endMetricsPhase(metrics, "handoff-readiness", phaseStarted);
  const readyAt = isoNow(clock);
  setPhase(draft, PHASES.DELIVERED, readyAt);
  draft.readyAt = readyAt;
  const startingFiles = new Map((draft.implementationBaseline?.files ?? []).map((item) => [item.path, item]));
  const endingFiles = new Map(inventory.files.map((item) => [item.path, item]));
  const changedFiles = [...new Set([...startingFiles.keys(), ...endingFiles.keys()])]
    .filter((file) => JSON.stringify(startingFiles.get(file)) !== JSON.stringify(endingFiles.get(file)))
    .map((file) => ({
      path: file,
      status: !startingFiles.has(file) ? "A" : !endingFiles.has(file) ? "D" : "M",
    }));
  const withinImpact = (file) => draft.solution.impactPaths.some((impact) => (
    file === impact || file.startsWith(`${impact}/`) || impact.startsWith(`${file}/`)
  ));
  const creationFiles = new Map((draft.creationBaseline?.files ?? []).map((item) => [item.path, item]));
  const preexistingDirty = (file) => creationFiles.has(file) && !startingFiles.has(file);
  const scopeDrift = changedFiles.map((item) => item.path).filter((file) => !withinImpact(file) && !preexistingDirty(file));
  draft.delivery = { changedFiles, scopeDrift };
  draft.history.push({ event: "FINALIZATION_COMPLETED", at: readyAt, details: { sourceFingerprint: inventory.fingerprint, manifestDigest: manifestInfo.digest } });
  metrics.wallTimeMs = Math.max(0, Date.now() - wallStart);
  applyBudgets(metrics, manifestInfo.manifest.budgets);
  assert(metrics.checkGroupRuns.broad === 1, "FINALIZATION_REPETITION_LIMIT", "A successful fingerprint requires exactly one broad group.");
  assert(
    metrics.uatJourneyRuns === (executedJourney ? 1 : 0),
    "FINALIZATION_REPETITION_LIMIT",
    executedJourney
      ? "A successful fingerprint requires exactly one complete automatic UAT journey."
      : "A manual-only handoff must not claim an automatic UAT journey.",
  );
  assert(metrics.affectedHistoryPasses <= 1, "FINALIZATION_REPETITION_LIMIT", "A successful fingerprint permits at most one affected-history pass.");
  finishMetrics(metrics);
  const result = {
    schemaVersion: 1,
    taskId,
    status: "passed",
    completedAt: readyAt,
    sourceFingerprint: inventory.fingerprint,
    inventoryCount: inventory.count,
    manifestDigest: manifestInfo.digest,
    profileDigest: profileInfo.digest,
    verificationEpoch: draft.verification.epoch,
    metrics,
    affectedHistory: [...history.dependencyStates.keys()],
  };
  draft.finalization = { status: "complete", version: 1, completedAt: readyAt, sourceFingerprint: inventory.fingerprint, manifestDigest: manifestInfo.digest, metrics };
  draft.updatedAt = readyAt;
  const snapshot = {
    schemaVersion: 1,
    taskId,
    createdAt: readyAt,
    acceptanceSha256: draft.acceptance.sha256,
    solutionSha256: draft.solution.sha256,
    manifestDigest: manifestInfo.digest,
    sourceFingerprint: inventory.fingerprint,
    replay: {
      commands: manifestInfo.manifest.checks.find((group) => group.scope === "broad").commands,
      acceptanceIds: draft.acceptance.items.map((item) => item.id),
    },
  };
  const report = renderTaskReport(draft, handoff);
  const requirement = renderRequirementDocument(await readFile(files.requirement, "utf8"), draft, handoff);
  const notification = renderTaskNotification(draft, handoff);
  for (const [label, content] of [
    ["Final report", report],
    ["Requirement delivery document", requirement],
    ["Notification draft", notification],
    ["Finalization result", json(result)],
    ["Finalization snapshot", json(snapshot)],
    ["Resolved finalization manifest", json(manifestInfo.manifest)],
  ]) assertNoSecretValues(content, credentials.secretValues, label);
  const entries = [];
  for (const projected of history.dependencyStates.values()) entries.push({ target: projected.files.state, content: json(projected.state) });
  entries.push(
    { target: projectFiles(root).reverificationIndex, content: json(history.index) },
    { target: files.finalization, content: json(manifestInfo.manifest) },
    { target: files.preflight, content: json(preflight.result) },
    { target: files.uatPlan, content: json(plan) },
    { target: files.handoff, content: json(handoff) },
    { target: files.report, content: report },
    { target: files.notification, content: notification },
    { target: files.finalizeResult, content: json(result) },
    { target: files.finalizationSnapshot, content: json(snapshot) },
    { target: files.state, content: json(draft) },
    { target: files.requirement, content: requirement },
  );
  await atomicWriteBatch(root, entries, clock);
  try {
    await buildGraph(root, { persist: true, clock });
  } catch {
    // The graph is a rebuildable runtime index and never invalidates a completed delivery.
  }
  return { state: draft, files, result, unchanged: false };
}

/**
 * Run the whole default finalization ladder in one invocation: static
 * validation, the non-formal rehearsal, then exactly one formal run for the same
 * frozen fingerprint. Every stage keeps its own diagnostics and its own abort
 * behavior; only the round trips between them are removed.
 */
export async function fastFinalize(root, taskId, input = {}, clock = () => new Date()) {
  const validation = await validateFinalizationPlan(root, taskId, input);
  assert(validation.valid, "INVALID_FINALIZATION_MANIFEST", "Finalization manifest is invalid.", { errors: validation.errors });
  if (await finalizationUnchanged(root, taskId, input)) {
    // Repeating --fast for an already finalized fingerprint must not rehearse again.
    const repeated = await finalizeTask(root, taskId, input, clock);
    return { ...repeated, validation, preview: null };
  }
  const rehearsal = await dryRunFinalization(root, taskId, input, clock);
  const final = await finalizeTask(root, taskId, input, clock);
  return { ...final, validation, preview: rehearsal.preview };
}

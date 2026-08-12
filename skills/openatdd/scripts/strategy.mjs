import path from "node:path";
import {
  asArray,
  assert,
  atomicWrite,
  inferHumanLanguage,
  isoNow,
  pathExists,
  readJson,
  resolveInside,
} from "./lib.mjs";

const SOURCES = Object.freeze({
  openatdd: { name: "OpenATDD / ATDD", url: "https://github.com/denvey/OpenATDD" },
  specKit: { name: "GitHub Spec Kit", url: "https://github.com/github/spec-kit" },
  gsd: { name: "GSD Core", url: "https://github.com/open-gsd/gsd-core" },
  trellis: { name: "Trellis", url: "https://github.com/mindfold-ai/Trellis" },
  compound: { name: "Compound Engineering", url: "https://github.com/EveryInc/compound-engineering-plugin" },
  bmad: { name: "BMAD-METHOD", url: "https://github.com/bmad-code-org/BMAD-METHOD" },
  agentOs: { name: "Agent OS", url: "https://github.com/buildermethods/agent-os" },
  codeStable: { name: "CodeStable", url: "https://github.com/codestable/CodeStable" },
  comet: { name: "Comet", url: "https://github.com/rpamis/comet" },
  superpowers: { name: "Superpowers", url: "https://github.com/obra/superpowers" },
});

export const strategyCapabilityCatalog = Object.freeze([
  {
    id: "acceptance-first",
    labels: { "zh-CN": "验收优先与风险分层确认", en: "Acceptance-first risk-routed approvals" },
    sources: [SOURCES.openatdd, SOURCES.specKit],
  },
  {
    id: "adaptive-depth",
    labels: { "zh-CN": "Quick / Standard / Deep 自适应深度", en: "Quick / Standard / Deep adaptive depth" },
    sources: [SOURCES.gsd, SOURCES.trellis],
  },
  {
    id: "recommended-decisions",
    labels: { "zh-CN": "推荐式人类决策", en: "Recommendation-led human decisions" },
    sources: [SOURCES.bmad, SOURCES.openatdd],
  },
  {
    id: "progressive-solution-review",
    labels: { "zh-CN": "渐进方案与简洁性审查", en: "Progressive solution and simplicity review" },
    sources: [SOURCES.compound, SOURCES.specKit, SOURCES.superpowers],
  },
  {
    id: "scoped-context-recovery",
    labels: { "zh-CN": "作用域上下文与恢复", en: "Scoped context and recovery" },
    sources: [SOURCES.gsd, SOURCES.trellis, SOURCES.agentOs],
  },
  {
    id: "conditional-agents",
    labels: { "zh-CN": "条件式 Agent 与独立审查", en: "Conditional Agents and independent review" },
    sources: [SOURCES.superpowers, SOURCES.bmad, SOURCES.gsd],
  },
  {
    id: "risk-research",
    labels: { "zh-CN": "按风险启用外部调研", en: "Risk-routed external research" },
    sources: [SOURCES.gsd, SOURCES.trellis],
  },
  {
    id: "knowledge-learning",
    labels: { "zh-CN": "事故、不变量与长期知识", en: "Incidents, invariants, and long-term knowledge" },
    sources: [SOURCES.compound, SOURCES.codeStable, SOURCES.agentOs],
  },
  {
    id: "evidence-finalization",
    labels: { "zh-CN": "证据门禁、恢复与原子 Finalization", en: "Evidence gates, recovery, and atomic finalization" },
    sources: [SOURCES.comet, SOURCES.openatdd],
  },
  {
    id: "agent-evaluation",
    labels: { "zh-CN": "真实 Agent、裸基线与能力消融评测", en: "Real-Agent, bare baseline, and capability ablation evaluation" },
    sources: [SOURCES.comet, SOURCES.openatdd],
  },
]);

const CATALOG_BY_ID = new Map(strategyCapabilityCatalog.map((item) => [item.id, item]));

function t(language, chinese, english) {
  return language === "zh-CN" ? chinese : english;
}

function resultStatusCounts(state) {
  const counts = { passed: 0, manual: 0, failed: 0, affected: 0, unverified: 0 };
  for (const criterion of state.acceptance?.items ?? []) {
    const status = state.results?.[criterion.id]?.status ?? "unverified";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function checkStatusCounts(state) {
  const counts = { passed: 0, failed: 0, affected: 0, other: 0 };
  for (const check of Object.values(state.checks ?? {})) {
    if (counts[check.status] === undefined) counts.other += 1;
    else counts[check.status] += 1;
  }
  return counts;
}

const DELIVERY_PHASES = new Set(["IMPLEMENTING", "REPAIRING", "PRE_UAT"]);
const DELIVERY_TERMINAL_PHASES = new Set(["DELIVERED"]);

function elapsedMs(start, end) {
  const started = new Date(start ?? 0).getTime();
  const ended = new Date(end ?? 0).getTime();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

function deliveryTiming(state, clock) {
  const now = isoNow(clock);
  const completed = [...(state.timing?.phases ?? [])];
  if (state.timing?.currentPhase && !DELIVERY_TERMINAL_PHASES.has(state.timing.currentPhase) && state.timing.phaseStartedAt) {
    completed.push({
      phase: state.timing.currentPhase,
      startedAt: state.timing.phaseStartedAt,
      endedAt: now,
      durationMs: elapsedMs(state.timing.phaseStartedAt, now),
    });
  }
  const grouped = new Map();
  for (const phase of completed) {
    grouped.set(phase.phase, (grouped.get(phase.phase) ?? 0) + Number(phase.durationMs ?? elapsedMs(phase.startedAt, phase.endedAt)));
  }
  const phases = [...grouped.entries()]
    .map(([phase, durationMs]) => ({ phase, durationMs }))
    .sort((left, right) => right.durationMs - left.durationMs);
  const deliveryActiveMs = phases
    .filter((item) => DELIVERY_PHASES.has(item.phase))
    .reduce((sum, item) => sum + item.durationMs, 0);
  const contractElapsedMs = phases
    .filter((item) => ["ACCEPTANCE_DRAFT", "SOLUTION_DRAFT"].includes(item.phase))
    .reduce((sum, item) => sum + item.durationMs, 0);
  const end = state.readyAt ?? now;
  // The largest gaps between consecutive history events show where wall-clock
  // time actually went — long agent turns, human waits, or command execution —
  // at a finer grain than per-phase totals.
  const events = (state.history ?? []).filter((item) => item.at && item.event);
  const largestGaps = events.slice(1)
    .map((event, index) => ({
      fromEvent: events[index].event,
      toEvent: event.event,
      startedAt: events[index].at,
      durationMs: elapsedMs(events[index].at, event.at),
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5);
  return {
    taskWallTimeMs: elapsedMs(state.createdAt, end),
    deliveryActiveMs,
    contractElapsedMs,
    phases,
    largestGaps,
  };
}

function executionMetrics(state, clock) {
  const timing = deliveryTiming(state, clock);
  const preflights = (state.history ?? []).filter((item) => item.event === "ENVIRONMENT_PREFLIGHT");
  const resolvedIssues = (state.issues ?? []).filter((item) => item.status === "resolved");
  const dispatches = state.agents?.dispatches ?? [];
  const executionDispatches = dispatches.filter((item) => /execution|implementation/i.test(item.role ?? ""));
  const durations = executionDispatches.map((item) => elapsedMs(item.startedAt, item.updatedAt ?? item.completedAt));
  const implementationPhases = (state.timing?.phases ?? []).filter((item) => item.phase === "IMPLEMENTING");
  const lastImplementationEnd = implementationPhases.map((item) => item.endedAt).filter(Boolean).sort().at(-1);
  const lastAgentEnd = executionDispatches.map((item) => item.updatedAt ?? item.completedAt).filter(Boolean).sort().at(-1);
  const integrationTailMs = lastImplementationEnd && lastAgentEnd && new Date(lastImplementationEnd) >= new Date(lastAgentEnd)
    ? elapsedMs(lastAgentEnd, lastImplementationEnd)
    : 0;
  return {
    timing,
    preflight: {
      attempts: preflights.length,
      failed: preflights.filter((item) => item.details?.status === "failed").length,
      passed: preflights.filter((item) => item.details?.status === "passed").length,
    },
    issues: {
      total: state.issues?.length ?? 0,
      resolved: resolvedIssues.length,
      open: (state.issues ?? []).filter((item) => item.status === "open").length,
      repairDurationMs: resolvedIssues.reduce((sum, item) => sum + elapsedMs(item.openedAt, item.resolvedAt), 0),
    },
    agents: {
      criticalPathMs: durations.length ? Math.max(...durations) : 0,
      integrationTailMs,
    },
  };
}

function selectionFor(id, state, evaluationReports) {
  const assessed = state.routing?.status === "assessed";
  const lane = state.routing?.lane ?? null;
  switch (id) {
    case "acceptance-first":
      return { status: "selected", reason: "core-contract" };
    case "adaptive-depth":
      return assessed
        ? { status: "selected", reason: `lane:${lane}` }
        : { status: "unavailable", reason: "task-not-assessed" };
    case "recommended-decisions":
      return { status: "selected", reason: "human-decisions-only-when-material" };
    case "progressive-solution-review":
      return state.acceptance?.approvedAt
        ? { status: "selected", reason: "acceptance-approved" }
        : { status: "not-used", reason: "acceptance-not-approved" };
    case "scoped-context-recovery":
      return assessed && lane !== "quick"
        ? { status: "selected", reason: `lane:${lane}` }
        : { status: "not-used", reason: lane === "quick" ? "quick-keeps-context-in-memory" : "task-not-assessed" };
    case "conditional-agents":
      return (state.routing?.agents?.roles?.length ?? 0) > 0
        ? { status: "selected", reason: `lane:${lane};optional-roles:${state.routing.agents.roles.join(",")}` }
        : { status: "not-used", reason: `lane:${lane ?? "unknown"};no-agent-role-selected` };
    case "risk-research":
      return state.routing?.investigation?.externalResearch === true
        ? { status: "selected", reason: `lane:${lane};external-research-required` }
        : { status: "not-used", reason: `lane:${lane ?? "unknown"};local-discovery-sufficient` };
    case "knowledge-learning":
      return { status: "selected", reason: "scoped-memory-and-impact-policy" };
    case "evidence-finalization":
      return { status: "selected", reason: "deterministic-delivery-contract" };
    case "agent-evaluation":
      return evaluationReports.length > 0
        ? { status: "selected", reason: "evaluation-report-supplied" }
        : { status: "not-used", reason: "no-evaluation-report-supplied" };
    default:
      return { status: "unavailable", reason: "unknown-capability" };
  }
}

function stateEvidence(summary) {
  return { source: "state.json", summary };
}

function taskLocalSource(state, source) {
  const prefix = `git:tasks/${state.taskId}/`;
  return source?.startsWith(prefix) ? source.slice(prefix.length) : source;
}

function observationFor(id, state, evaluationReports, language) {
  const dispatches = state.agents?.dispatches ?? [];
  const resolvedIssues = (state.issues ?? []).filter((issue) => issue.status === "resolved");
  switch (id) {
    case "acceptance-first": {
      const approvals = [state.acceptance?.approvedAt, state.solution?.approvedAt].filter(Boolean).length;
      return approvals > 0
        ? { status: "observed", evidence: [stateEvidence(t(language, `已记录 ${approvals}/2 个合同批准`, `${approvals}/2 contract approvals recorded`))] }
        : { status: "not-used", evidence: [] };
    }
    case "adaptive-depth":
      return state.routing?.status === "assessed"
        ? { status: "observed", evidence: [stateEvidence(t(language, `深度=${state.routing.lane}；原因=${state.routing.reasons.join(",")}`, `lane=${state.routing.lane}; reasons=${state.routing.reasons.join(",")}`))] }
        : { status: "unavailable", evidence: [] };
    case "recommended-decisions":
      return (state.decisions?.length ?? 0) > 0
        ? { status: "observed", evidence: [stateEvidence(t(language, `${state.decisions.length} 条决策记录`, `${state.decisions.length} decision record(s)`))] }
        : { status: "not-used", evidence: [stateEvidence(t(language, "本次没有需要人的实质决策", "No material human decision was needed"))] };
    case "progressive-solution-review":
      return state.reviews?.solution
        ? { status: "observed", evidence: [stateEvidence(t(language, `方案审查=${state.reviews.solution.status}；审查者=${state.reviews.solution.reviewer}`, `solution review=${state.reviews.solution.status}; reviewer=${state.reviews.solution.reviewer}`))] }
        : { status: "not-used", evidence: [] };
    case "scoped-context-recovery":
      return state.context?.status === "prepared"
        ? { status: "observed", evidence: [{ source: taskLocalSource(state, state.context.path) ?? "state.json", summary: t(language, `上下文摘要=${state.context.digest}`, `context digest=${state.context.digest}`) }] }
        : { status: "not-used", evidence: [] };
    case "conditional-agents":
      return dispatches.length > 0
        ? { status: "observed", evidence: dispatches.map((item) => stateEvidence(`${item.id}:${item.role}:${item.status}`)) }
        : { status: "not-used", evidence: [stateEvidence(t(language, "没有记录 Agent 调用", "No Agent dispatch was recorded"))] };
    case "risk-research": {
      const research = dispatches.filter((item) => /research|investigation/i.test(item.role));
      return research.length > 0
        ? { status: "observed", evidence: research.map((item) => stateEvidence(`${item.id}:${item.role}:${item.status}`)) }
        : { status: "not-used", evidence: [stateEvidence(t(language, "没有记录外部调研调用", "No external-research dispatch was recorded"))] };
    }
    case "knowledge-learning":
      return resolvedIssues.length > 0 || (state.affectedDependencies?.length ?? 0) > 0
        ? {
          status: "observed",
          evidence: [stateEvidence(t(language, `${resolvedIssues.length} 个已解决问题；${state.affectedDependencies?.length ?? 0} 个受影响历史任务`, `${resolvedIssues.length} resolved issue(s); ${state.affectedDependencies?.length ?? 0} affected historical task(s)`))],
        }
        : { status: "not-used", evidence: [stateEvidence(t(language, "没有记录修复学习或历史影响", "No repair learning or historical impact was recorded"))] };
    case "evidence-finalization":
      return state.finalization?.status === "complete"
        ? { status: "observed", evidence: [{ source: "finalize-result.json", summary: `epoch=${state.verification?.epoch}; fingerprint=${state.finalization.sourceFingerprint}` }] }
        : Object.keys(state.checks ?? {}).length > 0
          ? { status: "observed", evidence: [stateEvidence(`${Object.keys(state.checks).length} check(s) recorded before finalization`)] }
          : { status: "not-used", evidence: [] };
    case "agent-evaluation":
      return evaluationReports.length > 0
        ? { status: "observed", evidence: evaluationReports.map((item) => ({ source: item.path, summary: `scenario=${item.report.scenario?.id ?? "unknown"}` })) }
        : { status: "not-used", evidence: [] };
    default:
      return { status: "unavailable", evidence: [] };
  }
}

function compactSummary(summary = {}) {
  return {
    runs: summary.runs ?? null,
    passRate: summary.passRate ?? null,
    meanScore: summary.meanScore ?? null,
    firstPassAcceptanceRate: summary.firstPassAcceptanceRate ?? null,
    humanTurns: summary.humanTurns ?? null,
    unnecessaryQuestions: summary.unnecessaryQuestions ?? null,
    researchMisroutes: summary.researchMisroutes ?? null,
    missedDecisions: summary.missedDecisions ?? null,
    overEngineeringMarkers: summary.overEngineeringMarkers ?? null,
    contractViolations: summary.contractViolations ?? null,
    inputTokens: summary.inputTokens ?? null,
    cachedInputTokens: summary.cachedInputTokens ?? null,
    uncachedInputTokens: summary.uncachedInputTokens ?? null,
    outputTokens: summary.outputTokens ?? null,
    durationMs: summary.durationMs ?? null,
  };
}

function evaluationGroups(evaluationReports) {
  const groups = [];
  for (const item of evaluationReports) {
    const report = item.report;
    groups.push({
      source: item.path,
      scenarioId: report.scenario?.id ?? null,
      profile: report.strategyProfile ?? { name: "full", enabledCapabilities: strategyCapabilityCatalog.map((capability) => capability.id), disabledCapabilities: [] },
      group: "primary",
      adapter: report.primary?.adapter ?? null,
      summary: compactSummary(report.primary?.summary),
    });
    if (report.baseline) {
      groups.push({
        source: item.path,
        scenarioId: report.scenario?.id ?? null,
        profile: { name: "bare", enabledCapabilities: [], disabledCapabilities: strategyCapabilityCatalog.map((capability) => capability.id) },
        group: "baseline",
        adapter: report.baseline.adapter ?? null,
        summary: compactSummary(report.baseline.summary),
      });
    }
    for (const ablation of report.ablations ?? []) {
      groups.push({
        source: item.path,
        scenarioId: report.scenario?.id ?? null,
        profile: ablation.profile,
        group: "ablation",
        adapter: ablation.adapter ?? null,
        summary: compactSummary(ablation.summary),
      });
    }
  }
  return groups;
}

function difference(left, right, key) {
  const a = left?.[key];
  const b = right?.[key];
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

function comparisonRows(groups) {
  const rows = [];
  for (const primary of groups.filter((item) => item.group === "primary")) {
    for (const candidate of groups.filter((item) => item.source === primary.source && item.group !== "primary")) {
      rows.push({
        scenarioId: primary.scenarioId,
        primary: primary.profile.name,
        comparedWith: candidate.profile.name,
        comparedGroup: candidate.group,
        passRateDelta: difference(primary.summary, candidate.summary, "passRate"),
        meanScoreDelta: difference(primary.summary, candidate.summary, "meanScore"),
        humanTurnsDelta: difference(primary.summary, candidate.summary, "humanTurns"),
        inputTokensDelta: difference(primary.summary, candidate.summary, "inputTokens"),
        uncachedInputTokensDelta: difference(primary.summary, candidate.summary, "uncachedInputTokens"),
        durationMsDelta: difference(primary.summary, candidate.summary, "durationMs"),
      });
    }
  }
  return rows;
}

function recommendations(state, groups, comparisons, language, execution) {
  const values = [];
  if (groups.length === 0) {
    values.push({
      action: "observe",
      capabilityId: "agent-evaluation",
      reason: t(language, "未提供评测报告，不能判断能力带来的质量或 Token 差异。", "No evaluation report was supplied, so quality and token deltas cannot be judged."),
    });
  }
  for (const row of comparisons) {
    if (row.passRateDelta > 0 || row.meanScoreDelta > 0) {
      values.push({
        action: "keep",
        capabilityId: row.comparedGroup === "ablation" ? row.comparedWith.replace(/^without-/, "") : "openatdd-full",
        reason: t(language, `相对 ${row.comparedWith}，完整策略的质量指标更高。`, `The full strategy has better quality metrics than ${row.comparedWith}.`),
      });
    } else if (row.passRateDelta === 0 && row.meanScoreDelta === 0 && row.inputTokensDelta > 0) {
      values.push({
        action: "reduce",
        capabilityId: row.comparedGroup === "ablation" ? row.comparedWith.replace(/^without-/, "") : "context-overhead",
        reason: t(language, `相对 ${row.comparedWith}，质量相同但多使用 ${row.inputTokensDelta} 个输入 Token；建议精简注入上下文后复测。`, `Quality matched ${row.comparedWith}, but used ${row.inputTokensDelta} more input tokens; reduce injected context and rerun.`),
      });
    } else {
      values.push({
        action: "observe",
        capabilityId: row.comparedWith,
        reason: t(language, "当前小样本不足以形成可靠优化结论。", "The current sample is too small for a reliable optimization conclusion."),
      });
    }
  }
  if ((state.agents?.dispatches?.length ?? 0) === 0 && state.routing?.lane !== "deep") {
    values.push({
      action: "keep",
      capabilityId: "conditional-agents",
      reason: t(language, "本次未调用 Agent，条件式策略避免了不必要的多 Agent 成本。", "No Agent was dispatched; the conditional policy avoided unnecessary multi-Agent cost."),
    });
  }
  if (state.routing?.lane === "quick" && execution.timing.deliveryActiveMs > 10 * 60 * 1000) {
    values.push({
      action: "reduce",
      capabilityId: "quick-critical-path",
      reason: t(language, "Quick 自主交付超过 10 分钟；应减少任务级脚手架、重复旅程和无关广泛检查。", "Quick autonomous delivery exceeded 10 minutes; remove task-local scaffolding, duplicate journeys, and unrelated broad checks."),
    });
  }
  if (execution.preflight.failed > 0) {
    values.push({
      action: "reduce",
      capabilityId: "environment-preflight",
      reason: t(language, `环境预检失败 ${execution.preflight.failed} 次；应复用项目级 epoch 内 assertions 命令。`, `Environment preflight failed ${execution.preflight.failed} time(s); reuse project-level in-epoch assertion commands.`),
    });
  }
  if (execution.agents.integrationTailMs > 5 * 60 * 1000) {
    values.push({
      action: "reduce",
      capabilityId: "integration-tail",
      reason: t(language, "实现 Agent 完成后仍存在超过 5 分钟的整合尾巴；应在每个模块完成时流水式整合。", "More than five minutes remained after implementation Agents completed; integrate each module as it finishes."),
    });
  }
  return [...new Map(values.map((item) => [`${item.action}:${item.capabilityId}:${item.reason}`, item])).values()].slice(0, 8);
}

export function buildStrategyRetrospective(state, evaluationReports = [], clock = () => new Date()) {
  const language = inferHumanLanguage(state.requirement, state.acceptance?.items?.map((item) => item.title));
  const capabilities = strategyCapabilityCatalog.map((metadata) => ({
    id: metadata.id,
    label: metadata.labels[language] ?? metadata.labels.en,
    sources: metadata.sources,
    selection: selectionFor(metadata.id, state, evaluationReports),
    execution: observationFor(metadata.id, state, evaluationReports, language),
  }));
  const groups = evaluationGroups(evaluationReports);
  const comparisons = comparisonRows(groups);
  const selected = capabilities.filter((item) => item.selection.status === "selected");
  const observed = capabilities.filter((item) => item.execution.status === "observed");
  const notUsed = capabilities.filter((item) => item.execution.status === "not-used");
  const execution = executionMetrics(state, clock);
  const metrics = {
    approvals: [state.acceptance?.approvedAt, state.solution?.approvedAt].filter(Boolean).length,
    decisions: {
      total: state.decisions?.length ?? 0,
      resolved: (state.decisions ?? []).filter((item) => item.status === "resolved").length,
      pending: (state.decisions ?? []).filter((item) => item.status === "pending").length,
    },
    agents: {
      total: state.agents?.dispatches?.length ?? 0,
      passed: (state.agents?.dispatches ?? []).filter((item) => item.status === "passed").length,
      criticalPathMs: execution.agents.criticalPathMs,
      integrationTailMs: execution.agents.integrationTailMs,
    },
    repairs: execution.issues.resolved,
    repairAttempts: state.repair?.attempts?.length ?? 0,
    issues: execution.issues,
    preflight: execution.preflight,
    timing: execution.timing,
    acceptance: resultStatusCounts(state),
    checks: checkStatusCounts(state),
    finalization: state.finalization?.metrics ?? null,
    evaluationGroups: groups,
  };
  return {
    schemaVersion: 1,
    generatedAt: isoNow(clock),
    taskId: state.taskId,
    language,
    phase: state.phase,
    lane: state.routing?.lane ?? null,
    laneReasons: state.routing?.reasons ?? [],
    summary: {
      selectedCapabilities: selected.map((item) => item.id),
      observedCapabilities: observed.map((item) => item.id),
      notUsedCapabilities: notUsed.map((item) => item.id),
    },
    capabilities,
    metrics,
    bottlenecks: execution.timing.phases.slice(0, 5),
    comparisons,
    recommendations: recommendations(state, groups, comparisons, language, execution),
    caveats: [
      t(language, "借鉴来源表示设计启发，不表示运行外部框架。", "Sources indicate design inspiration, not execution of external frameworks."),
      t(language, "策略选择、实际调用和效果相关性分开展示；单次对照不能证明因果。", "Selection, observed execution, and outcome correlation are separate; one comparison cannot prove causality."),
      t(language, "缺失数据保持不可用，不由模型猜测补全。", "Missing data remains unavailable and is never guessed by a model."),
    ],
  };
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—";
}

function metric(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function duration(value) {
  if (!Number.isFinite(value)) return "—";
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function sourceLinks(sources) {
  return sources.map((source) => `[${source.name}](${source.url})`).join("、");
}

function capabilityLabel(id, language) {
  if (language === "zh-CN" && id === "openatdd-full") return "完整 OpenATDD";
  if (language === "zh-CN" && id === "context-overhead") return "上下文开销";
  if (language === "zh-CN" && id === "quick-critical-path") return "Quick 关键路径";
  if (language === "zh-CN" && id === "environment-preflight") return "环境预检";
  if (language === "zh-CN" && id === "integration-tail") return "整合尾巴";
  const item = CATALOG_BY_ID.get(id);
  return item?.labels?.[language] ?? item?.labels?.en ?? id;
}

function localizedAction(value, language) {
  if (language !== "zh-CN") return value;
  return ({ keep: "保留", reduce: "减少", close: "关闭", observe: "继续观察" })[value] ?? value;
}

function localizedStatus(value, language) {
  if (language !== "zh-CN") return value;
  return ({ selected: "已选择", observed: "已实际观察", "not-used": "未使用", unavailable: "不可用" })[value] ?? value;
}

function localizedReason(value, language) {
  if (language !== "zh-CN") return value;
  const exact = {
    "core-contract": "核心交付合同",
    "task-not-assessed": "任务尚未评估",
    "human-decisions-only-when-material": "仅在存在实质决策时询问人",
    "acceptance-approved": "验收标准已批准",
    "quick-keeps-context-in-memory": "Quick 在内存中保持精简上下文",
    "no-agent-role-selected": "当前深度未选择 Agent 角色",
    "local-discovery-sufficient": "本地调查已经足够",
    "scoped-memory-and-impact-policy": "启用作用域记忆与影响策略",
    "deterministic-delivery-contract": "确定性交付合同",
    "evaluation-report-supplied": "已提供评测报告",
    "no-evaluation-report-supplied": "未提供评测报告",
  };
  if (exact[value]) return exact[value];
  return value
    .replace(/^lane:/, "任务深度：")
    .replace(/;optional-roles:/, "；可选角色：")
    .replace(/;external-research-required/, "；需要外部调研")
    .replace(/;local-discovery-sufficient/, "；本地调查已经足够")
    .replace(/;no-agent-role-selected/, "；未选择 Agent 角色");
}

function localizedLaneReason(value, language) {
  if (language !== "zh-CN") return value;
  return ({
    "cross-module-scope": "跨模块范围",
    "partial-project-pattern": "项目模式部分建立",
    "medium-uncertainty": "中等不确定性",
    "local-scope": "局部范围",
    "established-project-pattern": "已有项目模式",
    "low-uncertainty": "低不确定性",
    reversible: "可逆",
    "system-scope": "系统范围",
    "high-uncertainty": "高不确定性",
    "novel-cross-cutting-work": "新颖跨域工作",
  })[value] ?? value.replace(/^hard-escalator:/, "硬风险升级：");
}

function evidenceLinks(evidence) {
  if (evidence.length === 0) return "—";
  return evidence.map((item) => `[${path.basename(item.source)}](${item.source})：${item.summary}`).join("；");
}

export function renderStrategyRetrospective(retrospective) {
  const zh = retrospective.language === "zh-CN";
  const lines = [
    `# ${zh ? "策略回溯" : "Strategy retrospective"}：${retrospective.taskId}`,
    "",
    `## ${zh ? "一屏结论" : "One-screen summary"}`,
    "",
    `- ${zh ? "任务深度" : "Lane"}：${retrospective.lane ?? "—"}（${retrospective.laneReasons.map((item) => localizedLaneReason(item, retrospective.language)).join("，") || "—"}）`,
    `- ${zh ? "选择能力" : "Selected capabilities"}：${retrospective.summary.selectedCapabilities.map((id) => capabilityLabel(id, retrospective.language)).join("、") || "—"}`,
    `- ${zh ? "实际观察" : "Observed capabilities"}：${retrospective.summary.observedCapabilities.map((id) => capabilityLabel(id, retrospective.language)).join("、") || "—"}`,
    `- ${zh ? "未调用" : "Not used"}：${retrospective.summary.notUsedCapabilities.map((id) => capabilityLabel(id, retrospective.language)).join("、") || "—"}`,
    `- ${zh ? "确认 / 决策 / Agent / 修复" : "Approvals / decisions / Agents / repairs"}：${retrospective.metrics.approvals} / ${retrospective.metrics.decisions.total} / ${retrospective.metrics.agents.total} / ${retrospective.metrics.repairs}`,
    `- ${zh ? "自主交付 / 总墙钟" : "Autonomous delivery / total wall"}：${duration(retrospective.metrics.timing.deliveryActiveMs)} / ${duration(retrospective.metrics.timing.taskWallTimeMs)}`,
    "",
    `## ${zh ? "能力与来源" : "Capabilities and sources"}`,
    "",
    `| ${zh ? "能力" : "Capability"} | ${zh ? "借鉴来源" : "Sources"} | ${zh ? "策略选择" : "Selection"} | ${zh ? "实际调用" : "Observed"} | ${zh ? "证据" : "Evidence"} |`,
    "|---|---|---|---|---|",
  ];
  for (const item of retrospective.capabilities) {
    lines.push(`| ${escapeCell(item.label)} | ${sourceLinks(item.sources)} | ${escapeCell(`${localizedStatus(item.selection.status, retrospective.language)}：${localizedReason(item.selection.reason, retrospective.language)}`)} | ${escapeCell(localizedStatus(item.execution.status, retrospective.language))} | ${escapeCell(evidenceLinks(item.execution.evidence))} |`);
  }
  lines.push("", `## ${zh ? "效果指标" : "Outcome metrics"}`, "");
  lines.push(`- ${zh ? "预检尝试 / 失败" : "Preflight attempts / failures"}：${retrospective.metrics.preflight.attempts} / ${retrospective.metrics.preflight.failed}`);
  lines.push(`- ${zh ? "已解决问题 / 修复尝试" : "Resolved issues / repair attempts"}：${retrospective.metrics.issues.resolved} / ${retrospective.metrics.repairAttempts}`);
  lines.push(`- ${zh ? "Agent 关键路径 / 整合尾巴" : "Agent critical path / integration tail"}：${duration(retrospective.metrics.agents.criticalPathMs)} / ${duration(retrospective.metrics.agents.integrationTailMs)}`);
  lines.push(`- ${zh ? "验收状态" : "Acceptance statuses"}：${Object.entries(retrospective.metrics.acceptance).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  lines.push(`- ${zh ? "检查状态" : "Check statuses"}：${Object.entries(retrospective.metrics.checks).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  if (retrospective.metrics.finalization) {
    lines.push(`- Finalization：${retrospective.metrics.finalization.wallTimeMs ?? "—"} ms，${retrospective.metrics.finalization.commandInvocations ?? "—"} ${zh ? "次命令" : "commands"}`);
  }
  if (retrospective.metrics.evaluationGroups.length === 0) {
    lines.push(`- ${zh ? "评测" : "Evaluation"}：${zh ? "未提供评测报告" : "no evaluation report supplied"}`);
  } else {
    lines.push("", `### ${zh ? "评测组" : "Evaluation groups"}`, "");
    lines.push(`| ${zh ? "组" : "Group"} | ${zh ? "场景" : "Scenario"} | ${zh ? "通过率" : "Pass rate"} | ${zh ? "首次验收" : "First pass"} | ${zh ? "输入 / 缓存 / 输出 Token" : "Input / cached / output tokens"} | ${zh ? "耗时" : "Duration"} |`);
    lines.push("|---|---|---:|---:|---:|---:|");
    for (const group of retrospective.metrics.evaluationGroups) {
      lines.push(`| ${escapeCell(group.profile.name)} | ${escapeCell(group.scenarioId)} | ${percent(group.summary.passRate)} | ${percent(group.summary.firstPassAcceptanceRate)} | ${metric(group.summary.inputTokens)} / ${metric(group.summary.cachedInputTokens)} / ${metric(group.summary.outputTokens)} | ${metric(group.summary.durationMs)} ms |`);
    }
  }
  lines.push("", `### ${zh ? "阶段耗时" : "Phase timing"}`, "");
  lines.push(`| ${zh ? "阶段" : "Phase"} | ${zh ? "耗时" : "Duration"} |`);
  lines.push("|---|---:|");
  for (const phase of retrospective.metrics.timing.phases) lines.push(`| ${phase.phase} | ${duration(phase.durationMs)} |`);
  if ((retrospective.metrics.timing.largestGaps ?? []).length > 0) {
    lines.push("", `### ${zh ? "最大事件间隔" : "Largest event gaps"}`, "");
    lines.push(`| ${zh ? "从" : "From"} | ${zh ? "到" : "To"} | ${zh ? "间隔" : "Gap"} |`);
    lines.push("|---|---|---:|");
    for (const gap of retrospective.metrics.timing.largestGaps) {
      lines.push(`| ${escapeCell(gap.fromEvent)} | ${escapeCell(gap.toEvent)} | ${duration(gap.durationMs)} |`);
    }
  }
  lines.push("", `## ${zh ? "优化建议" : "Optimization recommendations"}`, "");
  for (const item of retrospective.recommendations) lines.push(`- **${localizedAction(item.action, retrospective.language)} · ${capabilityLabel(item.capabilityId, retrospective.language)}**：${item.reason}`);
  lines.push("", `## ${zh ? "解释边界" : "Interpretation limits"}`, "");
  for (const caveat of retrospective.caveats) lines.push(`- ${caveat}`);
  return `${lines.join("\n")}\n`;
}

export function strategyRetrospectiveSummary(retrospective) {
  const zh = retrospective.language === "zh-CN";
  return [
    `${zh ? "策略回溯" : "Strategy retrospective"}: ${retrospective.taskId}`,
    `${zh ? "任务深度" : "Lane"}: ${retrospective.lane ?? "—"}`,
    `${zh ? "自主交付耗时" : "Autonomous delivery"}: ${duration(retrospective.metrics.timing.deliveryActiveMs)}`,
    `${zh ? "选择 / 实际 / 未调用" : "Selected / observed / not used"}: ${retrospective.summary.selectedCapabilities.length} / ${retrospective.summary.observedCapabilities.length} / ${retrospective.summary.notUsedCapabilities.length}`,
    `${zh ? "建议" : "Recommendations"}: ${retrospective.recommendations.map((item) => `${localizedAction(item.action, retrospective.language)}:${capabilityLabel(item.capabilityId, retrospective.language)}`).join(", ") || "—"}`,
  ].join("\n");
}

export async function writeStrategyRetrospective(root, state, files, input = {}, clock = () => new Date()) {
  const evaluationReports = [];
  for (const requested of asArray(input.evaluationPaths).map(String)) {
    const resolved = resolveInside(root, requested);
    assert(await pathExists(resolved.resolved), "EVALUATION_REPORT_NOT_FOUND", `Evaluation report does not exist: ${requested}`);
    const report = await readJson(resolved.resolved);
    assert(report.schemaVersion === 1 && report.primary?.summary, "INVALID_EVALUATION_REPORT", `Invalid Agent evaluation report: ${requested}`);
    evaluationReports.push({ path: path.relative(files.task, resolved.resolved).split(path.sep).join("/"), report });
  }
  const retrospective = buildStrategyRetrospective(state, evaluationReports, clock);
  const markdown = renderStrategyRetrospective(retrospective);
  await atomicWrite(files.retrospective, markdown);
  await atomicWrite(files.retrospectiveJson, `${JSON.stringify(retrospective, null, 2)}\n`);
  return {
    retrospective,
    markdown,
    summary: strategyRetrospectiveSummary(retrospective),
    files: {
      markdown: files.retrospective,
      json: files.retrospectiveJson,
    },
  };
}

export function capabilityProfile(name = "full", disabledCapabilities = []) {
  const disabled = [...new Set(asArray(disabledCapabilities).map(String))];
  for (const id of disabled) assert(CATALOG_BY_ID.has(id), "UNKNOWN_CAPABILITY", `Unknown capability: ${id}`);
  return {
    name,
    enabledCapabilities: strategyCapabilityCatalog.map((item) => item.id).filter((id) => !disabled.includes(id)),
    disabledCapabilities: disabled,
  };
}

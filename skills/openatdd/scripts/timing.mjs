const TERMINAL_PHASES = new Set(["DELIVERED"]);

const STAGE_PHASES = Object.freeze({
  contract: new Set(["ACCEPTANCE_DRAFT", "ACCEPTANCE_APPROVED", "SOLUTION_DRAFT", "CONTRACT_APPROVED"]),
  implementation: new Set(["IMPLEMENTING"]),
  repair: new Set(["REPAIRING", "BLOCKED"]),
  verification: new Set(["PRE_UAT"]),
});

function timestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsed(startedAt, endedAt) {
  const start = timestamp(startedAt);
  const end = timestamp(endedAt);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

export function recordDurationMs(record) {
  if (record?.durationMs !== undefined && record?.durationMs !== null && record?.durationMs !== "" && Number.isFinite(Number(record.durationMs))) {
    return Math.max(0, Number(record.durationMs));
  }
  return elapsed(
    record?.startedAt ?? record?.createdAt ?? record?.plannedAt,
    record?.updatedAt ?? record?.completedAt ?? record?.integratedAt,
  );
}

export function projectStageTiming(state, now = new Date()) {
  const currentAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const intervals = [...(state.timing?.phases ?? [])].map((item) => ({ ...item }));
  if (state.timing?.currentPhase && state.timing.phaseStartedAt && !TERMINAL_PHASES.has(state.timing.currentPhase)) {
    intervals.push({
      phase: state.timing.currentPhase,
      startedAt: state.timing.phaseStartedAt,
      endedAt: currentAt,
      durationMs: elapsed(state.timing.phaseStartedAt, currentAt),
      current: true,
    });
  }
  const stages = Object.fromEntries(Object.keys(STAGE_PHASES).map((stage) => [stage, { durationMs: 0, phases: [] }]));
  for (const interval of intervals) {
    const durationMs = Math.max(0, Number(interval.durationMs ?? elapsed(interval.startedAt, interval.endedAt)));
    for (const [stage, phases] of Object.entries(STAGE_PHASES)) {
      if (!phases.has(interval.phase)) continue;
      stages[stage].durationMs += durationMs;
      stages[stage].phases.push({ phase: interval.phase, durationMs, current: interval.current === true });
      break;
    }
  }
  const dispatches = state.agents?.dispatches ?? [];
  const reviewerDurationMs = dispatches
    .filter((item) => item.role === "independent-review")
    .reduce((sum, item) => sum + recordDurationMs(item), 0);
  const workerDispatches = dispatches.filter((item) => ["bounded-implementation", "complex-implementation"].includes(item.role));
  const dispatchedSubtasks = new Set(workerDispatches.map((item) => item.subtaskId).filter(Boolean));
  const orchestrationSessions = Object.values(state.execution?.orchestration?.sessions ?? {})
    .filter((item) => !item.subtaskId || !dispatchedSubtasks.has(item.subtaskId));
  const workerDurationMs = [
    ...workerDispatches,
    ...orchestrationSessions,
  ].reduce((sum, item) => sum + recordDurationMs(item), 0);
  return {
    stages,
    attribution: {
      reviewerDurationMs,
      workerDurationMs,
      finalizationDurationMs: Math.max(0, Number(state.finalization?.metrics?.wallTimeMs ?? 0)),
    },
    projectedAt: currentAt,
  };
}

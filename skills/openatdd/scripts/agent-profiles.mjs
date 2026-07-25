import { assert } from "./lib.mjs";
import { HARD_ESCALATORS } from "./routing.mjs";

export const AGENT_PROFILE_DEFAULTS = Object.freeze({
  "local-discovery": Object.freeze({
    profile: "local-discovery",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    forkTurns: "none",
    sandbox: "read-only",
  }),
  "external-research": Object.freeze({
    profile: "external-research",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    forkTurns: "none",
    sandbox: "read-only",
  }),
  "clean-context-execution": Object.freeze({
    profile: "clean-context-execution",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    forkTurns: "none",
    sandbox: "workspace-write",
  }),
  "independent-review": Object.freeze({
    profile: "independent-review",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    forkTurns: "none",
    sandbox: "read-only",
  }),
});

const HARD_RISKS = new Set(HARD_ESCALATORS);

function consecutiveFailedRepairs(attempts = []) {
  let count = 0;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (!["failed", "no-progress"].includes(attempts[index]?.outcome)) break;
    count += 1;
  }
  return count;
}

export function profileForDispatch(input = {}) {
  const role = String(input.role ?? "").trim();
  const base = AGENT_PROFILE_DEFAULTS[role];
  assert(base, "UNKNOWN_AGENT_ROLE", `Unknown Agent role: ${role || "missing"}.`);
  const hardRisk = (input.riskSignals ?? []).some((signal) => HARD_RISKS.has(signal));
  const repairEscalation = role === "clean-context-execution"
    && consecutiveFailedRepairs(input.repairAttempts) >= 2;
  const reviewEscalation = role === "independent-review" && hardRisk;
  const escalated = repairEscalation || reviewEscalation;
  return {
    role,
    ...base,
    ...(escalated ? {
      profile: `${base.profile}-${reviewEscalation ? "high-risk" : "repair-escalation"}`,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    } : {}),
    escalation: reviewEscalation
      ? "hard-risk-independent-review"
      : repairEscalation
        ? "two-consecutive-failed-repairs"
        : null,
  };
}

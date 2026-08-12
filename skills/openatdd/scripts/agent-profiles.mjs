import { assert } from "./lib.mjs";

const DEFAULT_SCOUT_PROFILE = Object.freeze({
  profile: "luna-low-scout",
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
  forkTurns: "none",
  sandbox: "read-only",
  writable: false,
  leaf: true,
  canSpawnAgents: false,
  authority: "read-only-discovery",
});

const STANDARD_REVIEW_PROFILE = Object.freeze({
  profile: "sol-review",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  forkTurns: "none",
  sandbox: "read-only",
  writable: false,
  leaf: true,
  canSpawnAgents: false,
  authority: "read-only-independent-review",
});

const DEEP_REVIEW_PROFILE = Object.freeze({
  ...STANDARD_REVIEW_PROFILE,
  profile: "sol-critical-review",
  reasoningEffort: "xhigh",
});

const BOUNDED_IMPLEMENTATION_PROFILE = Object.freeze({
  profile: "luna-max-worker",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  forkTurns: "none",
  sandbox: "workspace-write",
  writable: true,
  leaf: true,
  canSpawnAgents: false,
  authority: "approved-subtask-only",
});

const COMPLEX_IMPLEMENTATION_PROFILE = Object.freeze({
  profile: "terra-high-worker",
  model: "gpt-5.6-terra",
  reasoningEffort: "high",
  forkTurns: "none",
  sandbox: "workspace-write",
  writable: true,
  leaf: true,
  canSpawnAgents: false,
  authority: "approved-subtask-only",
});

const LOW_BROWSER_PROFILE = Object.freeze({
  mode: "browser-low",
  profile: "browser-execution",
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
  forkTurns: "none",
  sandbox: "read-only",
  capabilities: Object.freeze(["browser"]),
  reuseSession: true,
  screenshotPolicy: "checkpoint-or-failure",
  escalation: "main-on-failure-or-uncertainty",
});

export const AGENT_PROFILE_DEFAULTS = Object.freeze({
  "local-discovery": DEFAULT_SCOUT_PROFILE,
  "external-research": DEFAULT_SCOUT_PROFILE,
  "bounded-implementation": BOUNDED_IMPLEMENTATION_PROFILE,
  "complex-implementation": COMPLEX_IMPLEMENTATION_PROFILE,
});

const LEGACY_AGENT_PROFILE_DEFAULTS = Object.freeze({
  "clean-context-execution": Object.freeze({
    profile: "clean-context-execution",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    forkTurns: "none",
    sandbox: "workspace-write",
  }),
});

export function profileForDispatch(input = {}) {
  const role = String(input.role ?? "").trim();
  const lane = String(input.lane ?? "standard").trim();
  const deliveryVersion = Number(input.deliveryVersion ?? 3);
  const base = role === "independent-review"
    ? (lane === "deep" ? DEEP_REVIEW_PROFILE : STANDARD_REVIEW_PROFILE)
    : AGENT_PROFILE_DEFAULTS[role]
    ?? (deliveryVersion < 3 ? LEGACY_AGENT_PROFILE_DEFAULTS[role] : undefined);
  assert(base, "UNKNOWN_AGENT_ROLE", `Unknown Agent role: ${role || "missing"}.`);
  return {
    role,
    ...base,
    escalation: null,
  };
}

export function verificationExecutionProfile(input = {}) {
  const surface = String(input.surface ?? "cli").trim().toLowerCase();
  const requestedMode = String(input.mode ?? "auto").trim().toLowerCase();
  assert(["auto", "deterministic", "browser-low", "human"].includes(requestedMode), "INVALID_VERIFICATION_EXECUTOR", `Unknown verification execution mode: ${requestedMode || "missing"}.`);
  if (requestedMode === "human" || input.subjectiveVisual === true) {
    return {
      mode: "human",
      model: null,
      reasoningEffort: null,
      reason: "Subjective visual judgment remains as a manual UAT step in the delivery report.",
    };
  }
  if (requestedMode === "deterministic" || surface !== "web" || input.deterministicAvailable === true) {
    return {
      mode: "deterministic",
      model: null,
      reasoningEffort: null,
      reason: surface === "web"
        ? "A stable command-backed browser journey is available, so execution uses no model."
        : `The ${surface || "project"} journey is command-backed and uses no model executor.`,
    };
  }
  return { ...LOW_BROWSER_PROFILE };
}

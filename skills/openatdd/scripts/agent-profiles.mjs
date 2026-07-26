import { assert } from "./lib.mjs";

const DEFAULT_SCOUT_PROFILE = Object.freeze({
  profile: "default",
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
  forkTurns: "none",
  sandbox: "read-only",
});

export const AGENT_PROFILE_DEFAULTS = Object.freeze({
  "local-discovery": DEFAULT_SCOUT_PROFILE,
  "external-research": DEFAULT_SCOUT_PROFILE,
  "independent-review": DEFAULT_SCOUT_PROFILE,
});

export function profileForDispatch(input = {}) {
  const role = String(input.role ?? "").trim();
  const base = AGENT_PROFILE_DEFAULTS[role];
  assert(base, "UNKNOWN_AGENT_ROLE", `Unknown Agent role: ${role || "missing"}.`);
  return {
    role,
    ...base,
    escalation: null,
  };
}

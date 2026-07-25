# Solution card: UAT delivery v2

## Implementation

- Extend task state to schema v2 with a verification epoch, preflight status,
  UAT batches, handoff metadata, check scopes, source fingerprints, and phase
  timing. Migrate schema-v1 tasks in memory and persist the upgrade only on the
  next normal mutation so existing projects and READY reports remain readable.
- Add project-scoped profiles under `.openatdd/environments/` using a strict,
  flat YAML schema that needs no third-party parser. Keep URLs, commands,
  organization references, fixture references, applicability, sources,
  confidence, and `last_verified_at` in YAML; keep structured observations and
  stale history in JSON indexes.
- Generate `.env.openatdd.example` and idempotently ignore
  `.env.openatdd.local`. Load the local dotenv file with a restricted parser
  that forbids interpolation and command substitution. Resolve only named
  credential references at runtime, retain values in process memory, redact
  them from outputs, and scan persisted task/memory/report artifacts for
  secret-like keys and loaded values.
- Add internal CLI operations for environment initialization/observation,
  preflight recording, UAT-plan validation, batch-result recording, and
  handoff metadata. Preflight blocks formal Web UAT until workspace identity,
  services, entry URLs, required env variables, login/role or organization,
  integration configuration, fixtures, and known workarounds are verified.
- Store `uat-plan.json` per task. Require every acceptance ID to appear in a
  validated batch, defaulting to setup/login, primary journey, and final
  readback/evidence. Update the Skill to execute one cohesive Playwright script
  per batch, reuse the session, and capture DOM/screenshots only at declared
  checkpoints or failure before narrowing a failed batch.
- Increment the verification epoch after solution approval, contract reopen,
  affected shared changes, or resolved issues. Attach the epoch to evidence and
  checks, reject passed acceptance/check records while any issue is open, and
  require readiness evidence from the current clean epoch.
- Add `focused`, `module`, and `broad` check scopes plus a source fingerprint.
  Guide agents to use focused checks during edits, module checks after repair,
  and one broad run after code freeze. Record timings and configurable budget
  warnings, but never fail quality solely because elapsed time exceeded a
  target.
- Validate a task-local `handoff.json` before readiness. Render “Start here”,
  detailed checkbox steps derived from Given/When/Then acceptance fields,
  expected results, evidence, human judgments, and a consolidated applicable
  link section. Render the notification with version, entry/environment,
  report link, estimated effort, and first action.
- Expand deterministic tests and dev/regression/holdout evaluations for
  migration, scoped environment reuse, stale observations, dotenv redaction,
  preflight failures, batched browser planning, verification epochs, check
  ordering, performance warnings, and detailed handoff output.

## Impact paths

- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/verification-routing.md`
- `skills/openatdd/references/environment-profiles.md`
- `skills/openatdd/scripts/lib.mjs`
- `skills/openatdd/scripts/profiles.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `tests`
- `evals`
- `README.md`
- `.gitignore`
- `.openatdd`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | Validated `handoff.json`, enriched report renderer, and direct notification links | Report/notification fixtures, local-path checks, URL/applicability failures |
| AC-02 | Environment profiles, scoped observation index, evidence-backed merge, and stale history | Multi-task recall/update/reuse tests and memory evaluation |
| AC-03 | Dedicated dotenv/example files, restricted runtime loader, redactor, Git-ignore maintenance, and artifact scanner | Loading, missing-variable, injection rejection, redaction, and secret-scan tests |
| AC-04 | Required preflight contract and persisted results before formal UAT | Wrong-root, port/service, login/org, integration, fixture, workaround, and cached-success tests |
| AC-05 | Validated UAT batches plus Skill rules for cohesive Playwright scripts and checkpoints | Batch coverage, round-trip budget, checkpoint, session reuse, and failed-batch recovery evaluations |
| AC-06 | Schema-v2 verification epochs, open-issue pass guard, epoch-tagged evidence, and migration | Issue lifecycle, stale-epoch, complete-rerun, incident memory, and v1 migration tests |
| AC-07 | Scoped checks, source fingerprints, phase timing, budgets, and final broad-check policy | Ordering/deduplication, fingerprint change, coverage retention, timing, and warning evaluations |

## Risks

- Generic projects expose different login and health mechanisms. Keep built-in
  preflight deterministic for workspace, file, env, URL, and reachability; let
  the agent record project-specific login/organization assertions with fresh
  evidence rather than pretending OpenATDD understands every application.
- YAML and dotenv parsing can become an injection surface. Support only a
  documented flat YAML/dotenv subset, reject duplicate or unknown-sensitive
  keys, variable expansion, shell syntax, and malformed quoting.
- Loaded secrets can leak through tool arguments or debugging output. Keep
  values out of model-facing state, centralize redaction, scan every persisted
  artifact, and fail readiness if a loaded value appears.
- Schema migration and stricter readiness can break completed v1 tasks. Make
  migration additive, preserve existing evidence semantics, and require new
  handoff/preflight fields only for tasks created or reopened under schema v2.
- Batching too aggressively can hide the failing action. Preserve named steps
  and checkpoints inside each batch and split only the failed batch during
  diagnosis.

## Deliberate exclusions

- Do not add a third human approval point, dashboard, hosted service, database,
  mandatory multi-agent topology, or new runtime package dependency.
- Do not store production credentials, build a general secret manager, commit
  `.env.openatdd.local`, or authorize the agent to print or transmit secrets.
- Do not impose a hard wall-clock cancellation or weaken acceptance, evidence,
  regression, security, deployment, or notification authorization because a
  task exceeds its performance budget.
- Do not attempt universal project startup or login automation; use validated
  project profiles and explicit project-specific preflight assertions.
- Do not deploy, send external notifications, or mutate production data.

# Verification routing

Prefer the narrowest deterministic verifier that observes the approved result.
Use the task lane to scale breadth, not to weaken evidence: Quick favors one
direct local path, Standard adds cross-module boundaries, and Deep adds
independent and risk-specific verification. Load the `verification` view from
the task's scoped context; do not reuse implementation assumptions as proof.

| Surface | Primary verifier | Typical evidence |
|---|---|---|
| Business rule | Unit or domain test | Test output and focused assertions |
| Service interaction | Integration test | Logs, responses, persisted state |
| API and permissions | HTTP client or project API tests | Sanitized request/response |
| Web user journey | Playwright or browser controller | Screenshots, DOM facts, network result |
| Database outcome | Read-only query or repository API | Sanitized rows or counts |
| XLSX/CSV/PDF | Format-aware parser | Parsed values, totals, page/row counts |
| CLI | Real process execution | Exit code, stdout/stderr, created files |
| Complex visual canvas | Visual AI only when deterministic access is insufficient | Image plus explicit human judgment |

## Evidence rules

- Capture evidence after solution approval and after the latest relevant repair.
- Store local evidence in the task's Git-private `tasks/<task>/evidence/` directory.
- Remove secrets, tokens, personal data, and unsafe production payloads.
- Record failed observations as failures; never overwrite them into passes.
- After a repair, rerun the failed item, affected items, relevant automated
  checks, and the complete approved main journey.
- For historical affected tasks, produce evidence newer than the solution that
  caused the impact.

## Browser verification

Use real roles and realistic data where safe. Check visible state and, when
important, API or persisted state. Avoid declaring success from screenshots
alone when structured assertions are available.

Before opening the browser, require a passing `preflight.json` and validated
`uat-plan.json`. Prefer three cohesive batches when the journey allows it:

1. setup, entry, and login;
2. the primary business journey;
3. final readback and evidence.

Reuse the same authenticated session. Read DOM state and capture screenshots at
meaningful checkpoints or failure, not after every click. A failed batch can be
narrowed during diagnosis, but after repair all formal batch and acceptance
evidence must be recaptured in the new verification epoch.

## Efficient check order

- `focused`: affected tests during implementation and each small repair;
- `module`: the relevant subsystem after repairs close;
- rehearsal: `openatdd finalize <task> --dry-run` against real entry points,
  without formal evidence or historical reruns;
- `broad`: the full risk-proportionate suite once inside formal finalization
  after the complete source fingerprint is frozen;
- approved journey: one complete command-backed journey in the same formal operation;
- history: one affected-history pass after current acceptance succeeds.

## Multi-session verification and integration

Parallel execution does not create a second verification path. The controller
freezes the intended working-tree state and candidate fingerprint before
dispatch, then verifies every session against its own base identity and exact
`writeScope`/`doNotTouch` contract. A worker PASS requires the declared checks,
fresh evidence, actual changed paths, and a readable worktree-local diff; a
worker lifecycle of `completed` alone is not evidence.

The Codex App adapter sequence is `create_thread` with an isolated worktree,
`send_message_to_thread`, `wait_threads`, and `read_thread`. The controller then
serially records `session-record`, validates `session-result`, and performs
`orchestration-integrate` in stage/`dependsOn` order. The core remains
host-agnostic; these are adapter actions, not direct proprietary API calls from
OpenATDD.

Keep partial outcomes explicit. `failed`, `blocked`, and `needs_input` sessions
retain their diagnostics and do not erase passed siblings; affected dependents
remain pending and the Sol/xhigh controller replans or takes the work directly.
A stale base, candidate drift, duplicate or missing thread/worktree/branch/base
identity, out-of-scope change, missing verification/evidence, or integration
conflict fails closed and cannot be recorded as PASS. Preserve independent
passed results, mark the affected session `conflict`/replan, and rerun the
affected checks plus the complete approved journey after integration succeeds.

Quick and single-session verification keep the existing routing and finalization
order. No orchestration result is `DELIVERED` by itself, and no adapter operation
automatically commits, pushes, opens a PR, deploys, or deletes branches. After
formal delivery, `orchestration-cleanup` verifies the task-recorded worktree,
same Git common-dir, immutable identity, integrated session state, and every
residual tracked/untracked/ignored path. Only a fully proven candidate is removed
without `--force`; all other candidates remain as evidence and are reported.

Successful formal verification enters `DELIVERED`. Automatic and API evidence
is presented without asking the person to repeat it. Blocking `ASSISTED` and
`MANUAL` criteria remain as human UAT steps; passing requires no reply, while an
objection enters the existing issue and repair flow.

If the rehearsal fails, return to focused repair and rehearse again. If a
post-freeze failure or source mutation occurs, use the issue flow, advance the
epoch, and execute one new complete finalization. Do not preserve partial formal
passes across fingerprints.

Duration and browser-round-trip budgets produce warnings only. They are a
signal to improve batching or environment memory, never a reason to weaken
coverage or fail acceptance by elapsed time alone.

## External blockers

Use `blocked` for unavailable credentials, services, permissions, CAPTCHA,
hardware, production authorization, equivalent external state, or three
recorded no-progress attempts without a new credible hypothesis. Ordinary
implementation errors and failing tests belong in the repair loop. A new
credible hypothesis resumes repair from the persisted recovery boundary.

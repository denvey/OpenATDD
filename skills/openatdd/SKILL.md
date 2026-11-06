---
name: openatdd
description: Run a complexity-routed, risk-overlaid acceptance-first AI delivery workflow from a natural-language requirement to autonomous implementation, verification, learning, and an evidence-backed delivery. Quick work uses compact autonomously approved contracts; Standard and Deep work use two concise human confirmations.
---

# OpenATDD runtime kernel

Turn one user requirement into an approved acceptance journey, a technical
solution checkpoint, autonomous implementation, evidence-backed verification,
and a default-complete delivery. Keep this kernel in context. Load a linked reference only
when its stated trigger applies.

## Interaction contract

- Follow the current conversation language automatically.
- Discover repository facts before asking. Ask only product, scope, cost, risk,
  or authorization decisions that cannot be safely inferred.
- Recommend one grounded option first, then give two or three choices with
  consequences. Batch independent decisions.
- Quick stays autonomous. Standard and Deep have exactly two routine human
  confirmations: acceptance, then solution. After delivery, no reply is needed
  unless the person finds an objection; only residual `MANUAL` criteria get UAT steps.
- Keep human-facing cards to one screen when practical. Do not expose routing,
  graph, context, Agent, or finalization machinery as extra confirmations.
- Within approved scope, continue without extra dispatch, test, or repair
  approvals. If an instruction blocks progress, identify its exact source and
  the concrete conflict; never invent host capabilities or model attestations.

## Non-negotiable rules

1. Draft acceptance before a formal solution.
2. Standard/Deep require explicit acceptance approval before solution drafting;
   Quick validates and approves its compact acceptance autonomously.
3. Standard/Deep require explicit solution approval before product changes;
   Quick completes simplicity review and autonomous solution approval first.
4. Never silently modify an approved card; reopen its gate.
5. Trace every solution row to an acceptance ID.
6. New tasks execute acceptance tests before product edits and freeze that contract;
   delivery reruns the same approved user journey. Unit tests alone are not delivery evidence.
7. Every passed blocking automatic criterion needs fresh evidence.
8. Mark affected historical criteria and reverify them after shared changes.
9. Every resolved defect records root cause, regression protection, and an invariant.
10. Never deploy or send external notifications without existing authorization.
11. Secrets stay only in ignored `.env.openatdd.local`; never copy values into
    cards, state, memory, reports, evidence, logs, or command output.
12. Do not capture passed formal evidence while an issue is open. After repair,
    advance the epoch and rerun the complete approved journey.

Treat unmistakable natural-language approval as approval and persist it
immediately. Never hand-edit Git-private state, issue, evidence, or index files.

## CLI and task start

Resolve this Skill directory and run:

```bash
node "<skill-directory>/scripts/openatdd.mjs" COMMAND --root "<project-root>"
```

Prefer an existing project `openatdd` executable. Inspect project instructions,
working-tree state, and relevant environment profile. Initialize only when
`.openatdd/` is absent.

For a new known-target task, create and assess in one call:

```bash
openatdd new TASK --requirement "one-line requirement" \
  --scope local|cross-module|system \
  --project-pattern established|partial|none \
  --reversibility reversible|costly|irreversible \
  --uncertainty low|medium|high [--risk SIGNAL] --json
```

Resume an existing task with `openatdd resume TASK`; read `status --json` only
when a machine summary is needed. Do not repeat persisted approvals.

## Route effort, overlay risk

- **Quick:** local, established, low uncertainty. Use compact autonomous
  contracts and implement inline in the current session; no routine research.
- **Standard:** cross-module or moderately uncertain. Use local discovery and
  optional read-only review only when useful.
- **Deep:** system-wide, novel cross-cutting, or high uncertainty. Perform
  parallel local discovery, relevant external research, and independent
  solution review. Record unavailable research.

Model routing is advisory and host-dependent. The controller is the model and
reasoning setting the user selected for the current conversation, including
design and final technical acceptance. Do not switch it for a lane, risk,
parallel batch, or role preference; there is no fixed Astra controller.
For authorized delegation, use these defaults unless the user specifies otherwise:

| Work | Preferred executor |
|---|---|
| Business logic, permissions, data consistency, complex implementation and repair | Sol / xhigh |
| UI, visual implementation and inspection, copy, documentation, dynamic browser acceptance | Terra 6.1 / xhigh |
| Stable browser journeys, API assertions, builds and regression checks | Existing deterministic commands, no model |

Use a preference only when the selected host tool supports that model and effort.
Otherwise use a suitable available executor, inheriting host settings when no
supported override exists, and report the substitution once. Do not guess model
IDs or treat tool availability elsewhere in the host as dispatch support.
A different or unknown model/effort does not block the workflow. Record actual
runtime metadata when exposed; never claim that guidance switched the runtime.
The controller implements and repairs inline by default. When applying this Skill,
use host-permitted subagents for bounded work when delegation improves total
delivery time; users need not append a separate delegation phrase. A model
preference does not require a Worker: keep small, context-rich work inline.
Respect user limits and host authorization requirements; this instruction does
not override a host that requires explicit user authorization for delegation.
Read-only permissions for scouts/reviewers, leaf capability, ownership, and
Worker isolation remain required and must be proven before delegation.

`status --json` and assessed `new` include `modelPolicy`. Before technical
acceptance, use that policy or `openatdd model-policy TASK --json`; concrete
unresolved concerns may be supplied with `--concern "reason"`. Acceptance keeps
the host's reasoning settings; sensitive risks or explicit concerns select a
critical review profile without prescribing an effort level. This command returns policy only;
it does not switch the current runtime. A separate `acceptance-review` dispatch
enforces read-only isolation and records available runtime metadata.

Risk never changes the complexity lane by itself. It strengthens authorization,
denial-path, rollback, compatibility, redaction, preflight, and evidence. The
`deletion`, `production`, `irreversible`, `shared-data-migration`, and
`external-side-effect` overlays require a recorded and resolved
`authorization` decision before any product code changes.

Assessed `new` already returns scoped memory/graph hits. Use a separate query
only for a refined need:

```bash
openatdd memory "requirement and likely paths" --limit 5 --json
```

Current product rules, architecture boundaries, and technical decisions live in
`.openatdd/knowledge/project.md`. `init` creates this one short, human-maintained
file without overwriting it. Every lane receives its source-hashed
`ProjectTruth` reference automatically; read it when implementing or verifying,
but do not silently invent or rewrite project facts. Keep only facts that are
still true—tasks, decisions, incidents, and Git retain history.

Read [governance.md](references/governance.md) only for material risk,
decisions, Deep work, Agent dispatch, graph/context diagnosis, affected history,
or repair.

## Gate 1 — acceptance

Inspect current roles, states, neighboring behavior, tests, and verification
environment. Complete the marked acceptance section in
`.openatdd/requirements/<task>.md` with one user goal, an observable journey,
criteria, boundaries, and exclusions. Quick uses 1-4 steps and 1-3 criteria;
Standard/Deep normally use 3-7 steps and 3-8 criteria.

```markdown
### AC-01 [AUTO] [BLOCKING] Observable result
- Given: ...
- When: ...
- Then: ...
- Evidence: ...
```

Use `AUTO`, `ASSISTED`, or `MANUAL` and `BLOCKING` or `NON_BLOCKING`. Read
[acceptance-patterns.md](references/acceptance-patterns.md) only for detailed
Web/API/file/role/state/visual patterns. Resolve blocking human decisions first.

Quick validates and persists approval autonomously. Standard/Deep present the
short card, apply feedback without hidden edits, then run:

```bash
openatdd approve-acceptance TASK
```

## Gate 2 — solution

Run `openatdd draft-solution TASK`. Complete the marked solution section in the
same requirement Markdown. Keep recommendation, project fit, main changes,
material risks, and exclusions before concise details, impact paths, and one
trace row per acceptance ID. Preserve all `openatdd:*` markers.

Review simplicity, project fit, summary/detail consistency, hidden material
choices, acceptance trace, and unnecessary infrastructure:

```bash
openatdd review-solution TASK --status passed --reviewer main \
  --check all --summary "concise finding"
```

Deep requires an independent solution review. Check read-only isolation
and leaf permission before dispatch. Model recommendations are not a gate.
A permanent `model_identity` or
`permission` failure records one idempotent unavailable outcome for that
solution fingerprint and does not consume a second runtime attempt. Otherwise,
the initial Reviewer receives a 15-minute hard budget. A Reviewer that returns
actionable findings succeeded; revise the solution and run one 5-minute targeted recheck.
A transient runtime failure may use one fresh Reviewer retry only.
Every dispatch is bound to the solution
fingerprint, round, attempt, host attestation, and actual duration; over-budget
PASS and a third attempt are rejected. If both runtime attempts fail, ordinary
Deep may record an explicit main-review fallback; dangerous Deep requires a
human decision via `openatdd review-fallback TASK --status approved|denied
--rationale "..." --human-confirmed` and cannot silently fall back. User-visible solution changes
reopen acceptance; other edits invalidate and repeat solution review.

### Optional multi-session execution

After solution approval in every lane, `begin` defaults to inline implementation
and returns `implement-inline`. New tasks require the acceptance manifest and
test adapters first; `begin` runs their baseline before allowing product edits.
It does not generate a Worker plan. An explicit parallel directive returns
`plan-execution` until the controller records a safe plan. Existing Worker plans
are preserved. After approval, the controller uses `plan-execution` when a bounded
handoff is useful and host-permitted; no separate workflow approval is required.
A returned Worker action from that plan uses the isolated-session
adapter. Separate sessions may perform discovery, research, independent review,
or an explicit `bounded-implementation` / `complex-implementation` plan.
Model profiles are recommendations; Workers remain leaf sessions with
`forkTurns:none` and `canSpawnAgents=false` and cannot change acceptance,
solution, authorization, or verdicts. Every writable Worker, including a
single Worker, uses its own isolated worktree; only a real parallel batch needs
the frozen shared-interface contract.

Evaluate safe decomposition during design before choosing parallel execution.
Use at most two implementation Workers at
once, with disjoint ownership and frozen shared interfaces. Integrate the
current batch before dispatching the next; use one Worker when dependencies
prevent parallelism. Workers return compact results and evidence locators, not
complete transcripts. After two no-progress repair attempts, return the failed
assertion, diff, and rejected hypotheses for controller diagnosis and a revised
repair plan. Do not add recursive delegation or routine controller polling.

Read [orchestration.md](references/orchestration.md) before delegating a worker,
before dispatching an independent reviewer, when the person approves the
solution with “批准方案，并行执行” (or an unmistakable equivalent), or when
running any `plan-execution`, `orchestration-*`, `session-*`, or `agent-*`
command. It holds the worker contract, the one-time parallel directive, the
frozen shared-interface contract, the host adapter order, the 15-minute
integration budget, and worktree cleanup.

Quick writes both compact cards in one working turn and runs the entire approval
chain once:

```bash
openatdd advance TASK --summary "concise review"
```

Standard/Deep present the short solution and, after approval, run:

```bash
openatdd approve-solution TASK --begin
```

Report any affected historical tasks before implementation.

## Implement and verify

Before product edits, create executable acceptance tests for the approved
criteria. Reuse the finalization manifest's `uat.batches`; every executable batch
declares `testFiles` containing assertions, adapters and fixtures. Commands print
structured per-criterion outcomes. Read [fast-finalization.md](references/fast-finalization.md)
for the result format. `begin`, `advance`, and `approve-solution --begin` run
preflight, smoke checks and the acceptance baseline. An assertion failure records
missing behavior; an all-passing baseline records existing satisfied behavior.
Startup, environment, timeout, missing coverage and invalid results block entry.
Baseline outcomes never count as formal acceptance passes. `--manifest PATH`
selects a task-specific plan and remains bound through resume and delivery.

Keep the test files, commands, preflight contract and environment profile frozen.
Resume, delegation, readiness and finalization reject drift. A necessary test
correction reopens the solution and rebuilds the baseline after approval.
Existing deliveryVersion 1–3 tasks retain their previous flow. Manual-only tasks
record `manual_only` and still require explicit human judgment.

Use existing architecture and conventions. Establish affected baselines, run
automatic preflight, implement the smallest complete change, add
risk-proportionate coverage, and review the actual diff/call paths.
Deterministic commands and authorized executors perform checks; dynamic browser
acceptance follows the executor preference above. The controller judges the final
diff, approved criteria, key call paths, actual evidence, and unresolved risks.
A Worker summary alone is not proof. Read relevant evidence rather than full
logs, and do not repeat verified operations merely to have the controller perform
them. Repeat checks only for changed inputs, failure, missing evidence, or a
concrete unresolved concern. Report blocking findings, evidence gaps, and residual
risks. Technical acceptance is not a substitute for human authorization or UAT.

Check order:

1. `focused` during edits and repair;
2. stop manually running manifest-owned `module`, `broad`, or UAT commands once
   the source is ready for finalization;
3. one `finalize --fast` invocation performs the rehearsal, one broad
   satisfaction, one complete approved journey, and affected-history pass.

Once required checks and technical review pass, broaden or repeat only for new
changes, failures, or concrete unresolved concerns. Keep the final journey and
fingerprint rules; do not add implementation-mirroring tests for trivial edits.

Do not run a known-failing repository-wide check for ceremony. Keep a real
passing broad group in the finalization manifest. For a local deterministic
harness with no live dependency, use project-scoped preflight with a reason;
never fabricate assertions.

When the manifest exists and the source is stable, use one invocation:

```bash
openatdd finalize TASK --fast
```

`--fast` performs static validation, one non-formal rehearsal, and one formal
finalization for the same fingerprint. Do not split it or reread generated state
after success. Split only for expected failure or narrow diagnosis:

```bash
openatdd validate-finalization TASK
openatdd finalize TASK --dry-run
openatdd finalize TASK
```

Read [verification-routing.md](references/verification-routing.md) before
nontrivial or mixed-surface delivery verification. Read
[fast-finalization.md](references/fast-finalization.md) only when creating or
debugging a manifest, preflight, evidence mapping, or history override.

For Web work, read
[browser-verification.md](references/browser-verification.md). Stable journeys
use zero-model commands; dynamic journeys use a bounded browser
executor; subjective visual conclusions remain human.

## Quick budget

Quick critical path:

```text
reproduce observable failure
→ trace active state sources
→ smallest complete patch
→ affected checks
→ one formal real user journey
```

For known-target Quick work, the default work budget is one location step, one
targeted batch read, one assessed `new`, both cards written together, one
`advance`, one patch with affected checks, one diff review, and one
`finalize --fast` — about six working turns. This is an optimization budget,
not a correctness cap. Exceed it only for a concrete risk or failed hypothesis.
Do not add unrelated foundational reading, repeated equivalent searches,
extra scouts/reviewers, or reference files the CLI already validates. Inline
implementation is the default; a controller-selected Worker keeps the same
bounded scope and verification obligations.

## Repair and handoff

Continue autonomously through ordinary failures. For a verified defect, use the
issue flow in [governance.md](references/governance.md), repair it, advance the
epoch, and rerun the complete journey.

Successful finalization enters `DELIVERED` and updates the top delivery section
of the single requirement Markdown. It starts with status/merge recommendation,
conclusion, and the human acceptance entry, followed by Reviewer focus and
actual changes. Automatic criteria show actual results without asking the
person to repeat tests. Blocking `ASSISTED` and `MANUAL` criteria add the full
ordered human operation chain. Record explicit human success with
`openatdd record TASK --acceptance AC-01 --status manual --human-confirmed`;
an objection reopens the same task through the issue flow.

Immediately after successful formal delivery, run `openatdd
orchestration-cleanup TASK --json`. Report every `cleaned`, `retained`, and
`failed` item with its reason. Cleanup is idempotent and best-effort: it must not
rerun finalization or roll back a successful delivery.

If inspection or human UAT finds a defect, resume the same task through the issue
flow, repair, rerun the entire journey, and generate a fresh delivery report.

Read [environment-profiles.md](references/environment-profiles.md) before
creating or changing an environment profile or `.env.openatdd.local`.
Read [agent-evaluation.md](references/agent-evaluation.md) only when acceptance
explicitly requires real-model evidence, cost comparison, ablation, or an
on-demand retrospective.

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
6. Execute the approved user journey; unit tests alone are not delivery evidence.
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
  contracts and one bounded Luna/max implementation Worker; no routine research.
- **Standard:** cross-module or moderately uncertain. Use local discovery and
  optional read-only review only when useful.
- **Deep:** system-wide, novel cross-cutting, or high uncertainty. Perform
  parallel local discovery, relevant external research, and independent
  solution review. Record unavailable research.

For design, Quick and Standard use `gpt-6-astra/medium`;
Deep uses `gpt-6-astra/high`. Parallelism alone never raises design effort.
Luna/max performs implementation, tests, and ordinary repairs. The host must
explicitly select and prove the routed profile; an
unproven model, effort, or permission blocks a compliant run.
The controller retains workspace write access for contracts and integration,
not routine product implementation. Unbounded work returns for diagnosis and
decomposition, then to Luna; direct GPT-6 implementation needs explicit user
authorization. Read-only applies to scouts and independent reviewers.

`status --json` and assessed `new` include `modelPolicy`. Before technical
acceptance, use that policy or `openatdd model-policy TASK --json`; concrete
unresolved concerns may be supplied with `--concern "reason"`. Acceptance uses
GPT-6/medium by default, high for sensitive risk overlays or explicit concerns,
even when design used high. This command resolves policy only: the host must
apply the model/effort; it does not switch the current runtime. A separate
`acceptance-review` dispatch enforces its recorded runtime attestation.

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

Deep requires an independent solution review. Check the selected model identity
and leaf permission before dispatch. A permanent `model_identity` or
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

After solution approval in every lane,
`begin` derives a conservative structured execution plan when approved impact
paths and manifest verification commands safely bound the work; otherwise it
persists a concrete `controller-sequential` reason. A returned Worker action is
not advisory: the host dispatches it through the isolated-session adapter.
Separate sessions are also used for read-only discovery and research (Luna/low),
independent solution review (GPT-6/medium for Standard, high for Deep), or an
explicit `bounded-implementation` / `complex-implementation` plan
(Luna/max leaf sessions with `forkTurns:none` and `canSpawnAgents=false` that
cannot change acceptance, solution, authorization, or verdicts). Ambiguous or
unbounded work returns for controller diagnosis and a narrower plan. Every writable Worker, including a
single Worker, uses its own isolated worktree; only a real parallel batch needs
the frozen shared-interface contract.

Evaluate parallelism during design. Use at most two implementation Workers at
once, with disjoint ownership and frozen shared interfaces. Integrate the
current batch before dispatching the next; use one Worker when dependencies
prevent parallelism. Workers return compact results and evidence locators, not
complete transcripts. After two no-progress repair attempts, return the failed
assertion, diff, and rejected hypotheses for GPT-6 diagnosis; Luna implements
the resulting repair. Do not add recursive delegation or routine GPT-6 polling.

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

Use existing architecture and conventions. Establish affected baselines, run
automatic preflight, implement the smallest complete change, add
risk-proportionate coverage, and review the actual diff/call paths.
Luna executes checks; GPT-6 judges the final diff against approved acceptance,
key call paths, actual evidence, and unresolved risks. A Worker summary alone
is not proof. Read linked source/evidence when needed rather than loading full
logs by default. Report only blocking findings, evidence gaps, and residual
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
use zero-model commands; dynamic journeys use a bounded Luna/low browser
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
extra scouts/reviewers, or reference files the CLI already validates. A bounded
implementation Worker is part of this budget, not an extra research phase.

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

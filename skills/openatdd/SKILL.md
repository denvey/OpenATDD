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

- **Quick:** local, established, low uncertainty. Work directly with compact
  autonomous contracts; no routine research or Agent.
- **Standard:** cross-module or moderately uncertain. Use local discovery and
  optional read-only review only when useful.
- **Deep:** system-wide, novel cross-cutting, or high uncertainty. Perform
  parallel local discovery, relevant external research, and independent
  solution review. Record unavailable research.

Routing also fixes the controller profile: Quick/Standard use
`gpt-5.6-sol` with `high`; Deep uses `gpt-5.6-sol` with `xhigh`. High never
auto-upgrades to xHigh. The host must explicitly select and prove the routed
profile; an unproven model, effort, or permission blocks a compliant run.
The controller retains workspace write access because Quick and unbounded work
remain direct; read-only applies to scouts and independent reviewers.

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

Deep requires a bounded independent-review dispatch and a passed independent
review bound to that Agent ID. User-visible solution changes reopen acceptance;
other edits invalidate and repeat solution review.

Read-only discovery and research use Luna/low. Independent review uses a fresh
Sol/high context for Standard and Sol/xhigh for Deep. After solution approval,
delegate only a structured execution plan: `bounded-implementation` uses
Luna/max and `complex-implementation` uses Terra/high. Both are leaf workers,
cannot create Agents or change acceptance, solution, authorization, scheduling,
or final verdicts, and must return scope-bound changes, verification, evidence,
and the current candidate fingerprint. Keep ambiguous or unbounded work in the
main Sol controller.
Run only one writable worker in a worktree at a time. Parallel writable work
requires isolated worktrees so actual path ownership can be proven.

```bash
openatdd plan-execution TASK --input execution-plan.json
openatdd agent-dispatch TASK --id AGENT-001 --role bounded-implementation \
  --subtask-id ST-001 --status running --attestation runtime.json
openatdd agent-result TASK --input execution-result.json
```

The input JSON files are transient caller inputs. OpenATDD persists the accepted
plan and result only in Git-private task state; do not add a public plan artifact.

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

Check order:

1. `focused` during edits and repair;
2. `module` after repairs close;
3. one manifest-driven rehearsal and formal journey;
4. one real `broad` group on the frozen source;
5. one complete approved journey and affected-history pass.

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
routine Agents, or reference files the CLI already validates.

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

If inspection or human UAT finds a defect, resume the same task through the issue
flow, repair, rerun the entire journey, and generate a fresh delivery report.

Read [environment-profiles.md](references/environment-profiles.md) before
creating or changing an environment profile or `.env.openatdd.local`.
Read [agent-evaluation.md](references/agent-evaluation.md) only when acceptance
explicitly requires real-model evidence, cost comparison, ablation, or an
on-demand retrospective.

---
name: openatdd
description: Run a simple acceptance-first AI delivery workflow from a natural-language requirement through two concise human confirmations to autonomous implementation, verification, learning, and a detailed UAT handoff. Adapt investigation and subagents to Quick, Standard, or Deep work; ask only material human decisions with grounded recommendations and 2-3 choices; preserve deterministic contracts, evidence, recovery, and affected-history reverification.
---

# OpenATDD

Turn a one-line requirement into a human-approved acceptance journey, a
human-approved solution, autonomous implementation, evidence-backed pre-UAT,
and a formal handoff. Keep normal interaction to material decisions plus two
short approvals. The person describes the outcome, chooses only what genuinely
needs human judgment, confirms completion standards and the solution, then
performs final UAT.

## Interaction contract

- Follow the language of the current conversation automatically. Do not ask
  for a language and do not add a language flag or project setting.
- Discover repository facts before asking questions. Never ask the person to
  locate code, choose routine tools, or decide facts the agent can inspect.
- Ask only product, scope, cost, risk, or authorization decisions that cannot
  be safely inferred. Batch independent decisions when that reduces waiting.
- For every human decision, give a project- and industry-grounded
  recommendation first, then two or three concise choices with consequences.
- Keep every human-facing card to one screen when practical. Put optional
  concise details below the summary in the same canonical file.
- Do not expose routing, graph, context, Agent, or finalization machinery as
  extra routine confirmations.

## Non-negotiable rules

1. Draft acceptance before a formal solution.
2. Obtain explicit acceptance approval before drafting the solution card.
3. Obtain explicit solution approval before modifying product code.
4. Never silently modify an approved card. Reopen the corresponding gate.
5. Trace every solution row to an acceptance ID.
6. Execute the approved user journey; do not substitute unit tests for pre-UAT.
7. Require fresh evidence for every passed blocking automatic criterion.
8. Mark affected historical criteria and reverify them after shared changes.
9. Record root cause, regression protection, and an invariant for every resolved defect.
10. Never send external notifications or deploy without existing authorization.
11. Keep local test values only in ignored `.env.openatdd.local`; never copy them
    into cards, state, memory, reports, evidence, logs, or command output.
12. Do not capture formal passed evidence while an issue is open. After repair,
    advance the verification epoch and rerun the complete approved journey.

Treat unmistakable natural-language approval as approval; do not force the user
to type a magic phrase. Use the CLI to persist the approval immediately.

## Use the deterministic CLI

Resolve `<skill-directory>` to the directory containing this `SKILL.md` and run:

```bash
node "<skill-directory>/scripts/openatdd.mjs" <command> --root "<project-root>"
```

Prefer the repository's `openatdd` executable when it is already available.
Never hand-edit `state.json`, `issues.md`, `report.md`, or the memory index.

## Start or resume

1. Locate the project root and inspect its instructions and working-tree state.
2. Run `openatdd init` if `.openatdd/` does not exist.
3. For a new task, choose a short hyphenated ID and run:

   ```bash
   openatdd new <task-id> --requirement "<one-line requirement>"
   ```

4. For an existing task, run `openatdd resume <task-id>` (and `openatdd status
   <task-id> --json` when a machine-readable summary is useful). Resume from
   the persisted phase and scoped context; do not repeat an approval already
   recorded.
5. Inspect the relevant code and classify the task from observed facts:

   ```bash
   openatdd assess <task-id> --scope local|cross-module|system \
     --project-pattern established|partial|none \
     --reversibility reversible|costly|irreversible \
     --uncertainty low|medium|high [--risk <signal>]
   ```

   - **Quick:** local, established, reversible, low uncertainty, no hard risk.
     Work directly; do not wait for external research or spawn routine Agents.
   - **Standard:** ordinary cross-module or moderately uncertain work. Use
     local discovery and optional independent review only when useful.
   - **Deep:** system/novel/high-uncertainty work or any hard risk such as
     migration, auth, authorization, payment, privacy, security, external
     services, production, deletion, irreversibility, or public compatibility.
     Perform parallel local discovery and relevant external research. Add
     clean-context execution and independent review when they materially reduce
     risk. If research access is unavailable, record that limitation instead of
     silently treating the Deep task like Standard.

   Routing controls internal effort, never the two-confirmation user contract.
6. Before either card, query relevant memory and the rebuildable graph:

   ```bash
   openatdd memory "<requirement and likely paths>" --json
   openatdd graph-query "<requirement and likely paths>" --json
   ```

Read only matched incident files and relevant code. Do not load all project
memory. Before both approvals, perform read-only discovery only.

If discovery exposes a material human-owned decision, record it with
`openatdd decision <task-id> --input <json-file>`. The record must contain the
owner, blocking status, one concise question, two or three options and their
consequences, a recommendation, and its basis. Persist the person's choice with
`openatdd resolve-decision`. Blocking decisions must be resolved before Gate 1.
Agent-owned implementation choices do not become user questions.

Also inspect the relevant profile in `.openatdd/environments/`. Profiles contain
only non-secret facts and variable names. Read
[environment-profiles.md](references/environment-profiles.md) before creating
or changing a profile or `.env.openatdd.local`.

## Gate 1: acceptance

Inspect the current product, roles, permissions, states, neighboring behavior,
tests, and likely verification environment. Fill `acceptance.md` with:

- one user-centered goal;
- a 3-7 step suggested journey by default;
- 3-8 criteria by default, expanded only for material risk;
- explicit boundaries and exclusions.

Use criterion headings exactly like:

```markdown
### AC-01 [AUTO] [BLOCKING] Authorized user exports matching orders
- Given: ...
- When: ...
- Then: ...
- Evidence: ...
```

Use `AUTO`, `ASSISTED`, or `MANUAL` and `BLOCKING` or `NON_BLOCKING`.
Read [acceptance-patterns.md](references/acceptance-patterns.md) only when the
task needs detailed patterns for Web, API, files, roles, state, or visual work.

Present the short card and pause for the first approval. Apply requested edits
and present it again. After approval, run:

```bash
openatdd approve-acceptance <task-id>
```

## Gate 2: solution

Run `openatdd draft-solution <task-id>`. Keep `solution.md` as the one canonical
source. Its first screen must contain a recommendation, why it fits this
project, main changes, material risks, and exclusions. Put optional concise
implementation details, concrete impact paths, and one trace-table row for
every acceptance ID below it. Use the current conversation language; the
language-independent `openatdd:*` HTML markers are the parser contract.

Do not invent architecture work that has no acceptance rationale. Present the
short summary and link the same file for details. Before presenting it, review
the current solution for simplicity, project fit, summary/detail consistency,
hidden material choices, acceptance trace, and unnecessary infrastructure:

```bash
openatdd review-solution <task-id> --status passed \
  --reviewer main|independent --check all \
  --summary "<concise finding>" [--agent-id AGENT-001]
```

Quick tasks may use the main Agent; Deep tasks require an independent review.
For Deep tasks, first record a bounded `independent-review` dispatch with
`openatdd agent-dispatch --surface verification`, then bind its Agent ID to the
review. A passed independent review without that scoped-context trace is
rejected.
Any solution edit invalidates the review hash. If feedback changes user behavior
or outcomes, run `openatdd reopen-acceptance <task-id> --reason "..."` and return
to Gate 1. Otherwise update the solution and, after approval, run:

```bash
openatdd approve-solution <task-id>
openatdd begin <task-id>
```

Solution approval automatically performs conservative path-overlap analysis.
Report any historical tasks marked `affected` before implementation.

## Implement without extra routine approvals

After both gates pass:

1. Run `openatdd begin <task-id>`; this prepares distinct implementation and
   verification context. Quick context stays in memory, while Standard/Deep
   context is persisted to the task's single `context.json` recovery boundary.
2. Establish relevant baseline checks.
3. Recall the scoped environment profile and verified project observations.
4. Run automatic preflight. For project-specific login, organization,
   integration, or fixture assertions, write a sanitized JSON assertion file:

   ```bash
   openatdd preflight <task-id> --environment local --assertions <file>
   ```

5. Implement using the project's existing architecture and conventions.
6. Add risk-proportionate unit, integration, API, file, or browser coverage.
7. Use `focused` checks during edits and `module` checks after repairs. Do not
   run the final broad group or record formal passed evidence yet.
8. Review the actual diff and affected call paths.
9. Read [fast-finalization.md](references/fast-finalization.md), then run the
   default pre-freeze rehearsal:

   ```bash
   openatdd finalize <task-id> --dry-run [--assertions <file>]
   ```

10. Repair every rehearsal finding with focused checks. When the rehearsal is
   green and the complete source fingerprint is stable, run exactly one formal
   finalization for that fingerprint:

   ```bash
   openatdd finalize <task-id> [--assertions <file>]
   ```

   This one operation performs final preflight, ordered check groups, the
   complete batched UAT journey, acceptance evidence mapping, affected-history
   reverification, handoff generation, and readiness validation.

Do not mandate TDD, Gherkin, worktrees, subagents, or a particular framework.
Choose them only when the project or task benefits. Read
[verification-routing.md](references/verification-routing.md) before executing
pre-UAT for a nontrivial or mixed-surface task.

For Web work, execute one cohesive script per generated batch. Reuse the
authenticated session, capture DOM facts/screenshots only at named checkpoints
or failure, and narrow only the failed batch during diagnosis. After any repair,
rerun every batch in the new clean epoch before recording formal acceptance.

`finalize --dry-run` is non-formal: it may write preview diagnostics and a
preview report, but must not advance the epoch, record passes, reverify history,
prepare a notification, or enter READY. If source, manifest, or environment
profile changes after a green preview, rehearse again before formal finalization.

Continue autonomously through ordinary code errors and test failures. Pause
only for a conflicting contract, a required behavior change, unavailable
credentials or external environment, CAPTCHA/hardware/manual approval, a
dangerous operation, new external authorization, or repeated lack of a new
credible repair hypothesis.

When subagents are used, give each a bounded role and scoped context, then
record the dispatch with `openatdd agent-dispatch`. Do not create role-playing
teams or use subagents merely to imitate a process. Record repair hypotheses,
outcomes, and progress fingerprints with `openatdd repair-attempt`; three
repeated no-progress attempts without a new hypothesis form a recoverable
blocked boundary rather than an endless loop.

The semantic graph under `.openatdd/knowledge/graph.json` is a local,
source-hashed, rebuildable index, never a source of truth or an external graph
database. Missing or stale indexes are repaired automatically. Use graph
relationships together with conservative path overlap for affected-history
reverification; graph failure must never weaken or block deterministic
delivery.

Store reusable project standards under `.openatdd/knowledge/standards/` and
task-relevant investigation notes under `.openatdd/knowledge/research/` as
Markdown, text, JSON, or YAML. Standard context may include standards; Deep
context may also include relevant research. Both are source-hashed graph inputs,
not new human gates or authoritative replacements for task contracts.

When acceptance explicitly requires real Agent behavior evidence, run the
versioned scenario with the bundled real-model adapter and a bare baseline, then
verify the persisted report without invoking the model again:

```bash
openatdd agent-eval --scenario <scenario.json> --adapter codex \
  --bare-agent --runs 2 --report <report.json>
openatdd agent-eval --verify-report <report.json> \
  --min-runs 2 --require-baseline
```

Mock fixtures remain deterministic regression coverage, but never satisfy a
formal real-model evidence requirement.

Do not narrate internal strategy during normal execution. Only when the person
explicitly asks after a task to review what was used, run:

```bash
openatdd retrospect <task-id> [--eval-report <report.json>]
```

This command deterministically derives a concise strategy retrospective from
the existing task state and optional evaluation reports. It distinguishes
design inspiration, selected policy, observed execution, unused capabilities,
outcomes, and optimization suggestions. It must not invoke a model, change task
state, claim causal superiority, or expose hidden reasoning. Use `--json` for
the machine-readable form. Real capability ablations are also explicit and
cost-bearing; run them only when requested with Agent evaluation
`--ablate <capability-id>`, then pass that report to `retrospect`.

## Granular fallback and debugging

Use the commands below only when a project has not adopted a finalization
manifest, a person explicitly requests manual control, or a failed batch needs
narrow diagnosis. Do not duplicate a successful manifest-driven final run.

Save screenshots, responses, logs, parsed files, or command output under the
task's `evidence/` directory. Record each criterion:

```bash
openatdd record <task-id> --acceptance AC-01 --status passed \
  --summary "Observed result" --evidence <path>
```

For `ASSISTED` or `MANUAL`, use `--status manual` and state exactly what a
person must judge. Record relevant project checks:

```bash
openatdd check <task-id> --name "unit tests" --status passed \
  --scope broad --source-fingerprint <hash> \
  --command "npm test" --evidence <path>
```

Do not call an item passed without a current evidence file. The CLI stores its
digest and rejects missing, stale, or later-mutated evidence at readiness.
It also rejects passed results and checks while any issue remains open.

## Repair and learn

When pre-UAT fails, record the issue and continue repairing:

```bash
openatdd issue <task-id> --acceptance AC-03 --status open \
  --symptom "Expected 28 rows; observed 27"
```

Resolve it only after identifying durable protection:

```bash
openatdd issue <task-id> --id ISSUE-001 --status resolved \
  --root-cause "Pagination omitted the final cursor" \
  --regression "export_includes_final_page" \
  --invariant "Every matching row is exported exactly once" \
  --paths "src/export" --evidence <path>
```

Resolution writes scoped incident memory and invalidates earlier verification.
Rerun the full acceptance journey, not only the failed step. Reverify every
historical task listed as an affected dependency with evidence newer than the
current solution approval.

## Hand off

A successful `openatdd finalize <task-id>` already prepares the handoff, writes
the report and notification draft, and enters `READY_FOR_UAT`. For the granular
fallback only, run:

```bash
openatdd handoff <task-id>
openatdd ready <task-id>
```

Fix every reported blocker. When ready, the CLI writes `report.md` and
`notification.md`. The report must start with version, environment, role,
prerequisites, safe account-variable references, entry point, and estimated
time. It must include ordered one-action steps, expected results, Pass/Fail
checkboxes, prepared evidence, human judgments, and descriptive applicable
links. Treat the notification as a draft unless the project configuration and
current user authorization explicitly permit sending it.

If human UAT finds a defect, resume the same task, reopen delivery through the
issue flow, repair it, rerun the entire journey, and generate a fresh report.

---
name: openatdd
description: Run a lightweight, acceptance-first AI software delivery workflow with two separate human gates, deterministic contract protection, autonomous implementation and repair, scoped project memory, pre-UAT evidence, and readiness reporting. Use when a user invokes $openatdd, asks to deliver a feature or bug fix through human-approved acceptance and solution cards, resumes a task under .openatdd/, or wants affected historical acceptance reverified before handoff.
---

# OpenATDD

Turn a one-line requirement into a human-approved acceptance journey, a
human-approved solution, autonomous implementation, evidence-backed pre-UAT,
and a formal handoff. Keep normal user interaction to two short approvals.

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

4. For an existing task, run `openatdd status <task-id> --json` and resume from
   the persisted phase. Do not repeat an approval already recorded.
5. Before either card, query relevant memory:

   ```bash
   openatdd memory "<requirement and likely paths>" --json
   ```

Read only matched incident files and relevant code. Do not load all project
memory. Before both approvals, perform read-only discovery only.

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

Run `openatdd draft-solution <task-id>`. Fill `solution.md` with the smallest
credible implementation, concrete impact paths, one trace-table row for every
acceptance ID, risks, and deliberate exclusions.

Do not invent architecture work that has no acceptance rationale. Present the
short card and pause for the second approval. If feedback changes user behavior
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

1. Establish relevant baseline checks.
2. Implement using the project's existing architecture and conventions.
3. Add risk-proportionate unit, integration, API, file, or browser coverage.
4. Review the actual diff and affected call paths.
5. Run `openatdd pre-uat <task-id>`.
6. Execute the approved journey using deterministic tools first.

Do not mandate TDD, Gherkin, worktrees, subagents, or a particular framework.
Choose them only when the project or task benefits. Read
[verification-routing.md](references/verification-routing.md) before executing
pre-UAT for a nontrivial or mixed-surface task.

Continue autonomously through ordinary code errors and test failures. Pause
only for a conflicting contract, a required behavior change, unavailable
credentials or external environment, CAPTCHA/hardware/manual approval, a
dangerous operation, new external authorization, or repeated lack of a new
credible repair hypothesis.

## Record verification

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
  --command "npm test" --evidence <path>
```

Do not call an item passed without a current evidence file. The CLI stores its
digest and rejects missing, stale, or later-mutated evidence at readiness.

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

Run:

```bash
openatdd ready <task-id>
```

Fix every reported blocker. When ready, the CLI writes `report.md` and
`notification.md`. Summarize the version, environment, automatic results,
evidence, repaired defects, affected regressions, and remaining human
judgments. Treat the notification as a draft unless the project configuration
and current user authorization explicitly permit sending it.

If human UAT finds a defect, resume the same task, reopen delivery through the
issue flow, repair it, rerun the entire journey, and generate a fresh report.

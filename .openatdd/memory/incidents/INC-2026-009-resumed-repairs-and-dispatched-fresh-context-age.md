# INC-2026-009: Resumed repairs and dispatched fresh-context agents are not automatically supplied the scoped implementation or verification context.

- Area: skills/openatdd/scripts/workflow.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-004
- Created: 2026-07-24T02:50:19.010Z

## Root cause

Resume, repair, and Agent dispatch recorded control state but did not invoke one shared scoped-context loader for the appropriate surface.

## Invariant

INV-2026-009: Every resumed delivery action and fresh-context Agent receives the current source-hashed implementation or verification view before work continues.

## Regression protection

- resume
- repair attempts
- and Agent dispatch restore and record source-hashed scoped context

## Impact paths

- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/context.mjs`
- `skills/openatdd/scripts/openatdd.mjs`

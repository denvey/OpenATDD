# INC-2026-004: Acceptance summary renders project-level evidence links relative to the task directory, so observations.json opens a missing path

- Area: skills/openatdd/scripts/workflow.mjs
- Source task: detailed-uat-handoff
- Source issue: ISSUE-002
- Created: 2026-07-23T10:32:27.656Z

## Root cause

The report summary reused project-root evidence paths directly even though report.md is nested under the task directory; the handoff renderer used a correct task-relative helper but resultTable did not

## Invariant

INV-2026-004: Every local link emitted into a task report must be computed relative to the report directory and validated to remain inside the project root

## Regression protection

- detailed handoff renders project-level observations evidence as ../../environments/observations.json

## Impact paths

- `skills/openatdd/scripts/workflow.mjs`
- `tests/delivery-v2.test.mjs`

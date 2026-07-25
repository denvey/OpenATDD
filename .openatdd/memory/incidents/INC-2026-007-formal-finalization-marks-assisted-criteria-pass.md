# INC-2026-007: Formal finalization marks ASSISTED criteria passed before the required human judgment and evidence boundary is complete.

- Area: skills/openatdd/scripts/finalization.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-002
- Created: 2026-07-24T02:49:44.489Z

## Root cause

Finalization collapsed prepared evidence and required human judgment into one passed status for every criterion classification.

## Invariant

INV-2026-007: Only AUTO acceptance can be finalized as passed; ASSISTED and MANUAL always remain explicit human judgments.

## Regression protection

- formal finalization keeps ASSISTED and MANUAL criteria manual and rejects ASSISTED self-pass

## Impact paths

- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/workflow.mjs`

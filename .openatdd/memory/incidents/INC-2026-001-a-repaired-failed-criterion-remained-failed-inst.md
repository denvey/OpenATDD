# INC-2026-001: A repaired failed criterion remained failed instead of becoming affected for full-chain reverification

- Area: skills/openatdd/scripts/workflow.mjs
- Source task: openatdd-mvp
- Source issue: ISSUE-001
- Created: 2026-07-23T05:08:20.967Z

## Root cause

Verification invalidation only selected passed and manual statuses, excluding the failed criterion that triggered repair

## Invariant

INV-2026-001: After a repair, every non-deferred acceptance result must become affected before reverification

## Regression protection

- regression-repair-invalidates-chain-001

## Impact paths

- `skills/openatdd/scripts/workflow.mjs`

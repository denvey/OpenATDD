# INC-2026-008: The solution summary order and review gate do not deterministically enforce risks, exclusions, consistency, or independent reviewer evidence.

- Area: skills/openatdd/scripts/contracts.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-003
- Created: 2026-07-24T02:50:03.468Z

## Root cause

The solution contract checked named sections but not their progressive order, and a free-form review lacked complete checks and independent reviewer provenance.

## Invariant

INV-2026-008: A solution can pass review only when its complete human summary precedes details and every required review check is bound to the current hash and reviewer evidence.

## Regression protection

- solution summary order
- six structured review checks
- and independent scoped-review dispatch are enforced

## Impact paths

- `skills/openatdd/scripts/contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`

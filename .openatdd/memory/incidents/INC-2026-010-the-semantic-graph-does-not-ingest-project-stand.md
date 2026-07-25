# INC-2026-010: The semantic graph does not ingest project standards or research and does not derive shared-invariant task impacts automatically.

- Area: skills/openatdd/scripts/graph.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-005
- Created: 2026-07-24T02:50:34.834Z

## Root cause

Graph discovery omitted standards and research directories, while invariants were keyed by incident identity instead of canonical content.

## Invariant

INV-2026-010: Relevant standards, research, and canonical invariant relationships remain source-hashed, rebuildable inputs to context and impact analysis.

## Regression protection

- standards and research enter scoped graph context and shared invariant content derives task impacts without path overlap

## Impact paths

- `skills/openatdd/scripts/graph.mjs`
- `skills/openatdd/scripts/context.mjs`

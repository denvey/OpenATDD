# INC-2026-005: Legacy projects without .openatdd/reverification/index.json fail during deferred historical finalization instead of initializing an empty cache index.

- Area: skills/openatdd/scripts/finalization.mjs
- Source task: fast-portable-finalization
- Source issue: ISSUE-001
- Created: 2026-07-23T12:46:00.490Z

## Root cause

The finalizer assumed the v0.3 reverification cache index had already been created, but resumed legacy repositories can predate that runtime artifact.

## Invariant

INV-2026-005: Historical finalization treats an absent runtime cache as an empty cache; cache presence is never a prerequisite for delivery.

## Regression protection

- affected history initializes a missing reverification index and recreates it atomically

## Impact paths

- `skills/openatdd/scripts/finalization.mjs`
- `tests/finalization.test.mjs`

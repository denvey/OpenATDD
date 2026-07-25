# INC-2026-003: CLI check options --scope, --source-fingerprint, and --duration-ms are ignored and persisted as broad/unspecified

- Area: skills/openatdd/scripts/openatdd.mjs
- Source task: detailed-uat-handoff
- Source issue: ISSUE-001
- Created: 2026-07-23T10:25:24.215Z

## Root cause

The CLI wiring patch forwarded scoped-check options from the acceptance-record branch instead of the check branch, so recordCheck received no scope, fingerprint, or duration

## Invariant

INV-2026-003: Every CLI option that changes persisted verification semantics must be forwarded by its owning command and covered by a real-process regression test

## Regression protection

- CLI check forwards scope
- source fingerprint
- and duration

## Impact paths

- `skills/openatdd/scripts/openatdd.mjs`
- `tests/delivery-v2.test.mjs`

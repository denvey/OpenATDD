# INC-2026-014: Formal complex delivery evaluation full-openatdd run 2 passed generated tests but failed hidden acceptance because eraseAt equaled deletionRequestedAt instead of exactly 30 days later; false-ready rate 50%.

- Area: evals/agent/scenarios/delivery-complex.v2.json
- Source task: optimize-atdd-runtime-cost
- Source issue: ISSUE-002
- Created: 2026-07-28T23:30:03.943Z

## Root cause

The complex evaluation hid required JavaScript Date input, ISO persistence, restore/purge audit events, idempotent return value, and null-redaction semantics that were absent from the visible story; generated tests could pass a different valid interpretation and create false readiness.

## Invariant

INV-2026-014: Every hidden acceptance assertion must trace to an explicit visible requirement; dynamic API input types, exact stored/returned values, state-transition side effects, idempotent results, and time boundaries are part of the acceptance contract.

## Regression protection

- delivery_complex_public_contract_matches_hidden_observables_and_full_passes_two_runs

## Impact paths

- `evals/agent/scenarios/delivery-complex.v2.json`
- `tests/agent-eval.test.mjs`

# INC-2026-011: The release finalization claims Agent evaluation coverage without a persisted report from an actual model and bare-agent comparison.

- Area: skills/openatdd/scripts/agent-eval.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-006
- Created: 2026-07-24T02:50:53.392Z

## Root cause

Formal acceptance relied on mock evaluation tests because no bundled real-model adapter, persisted-report verifier, or pass-rate guard existed.

## Invariant

INV-2026-011: A formal real-Agent claim requires repeated hidden-check evidence from the bundled real-model adapter; mock or partial-pass reports never satisfy it.

## Regression protection

- bundled Codex primary and bare adapters run twice and finalization verifies a 100-percent primary real-model report

## Impact paths

- `skills/openatdd/scripts/agent-eval.mjs`
- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `.openatdd/finalization.json`

# Solution card: OpenATDD MVP

## Implementation

- Ship an installable `openatdd` Codex Skill plus a Node.js 20 ESM CLI with no runtime dependencies.
- Store task cards, approvals, results, evidence manifests, issues, reports, and project memory under `.openatdd/`.
- Enforce both gates and immutable approved-card hashes in deterministic code rather than prompt instructions alone.
- Parse compact Markdown card conventions so every acceptance criterion is traceable and machine-checkable.
- Record evidence digests and timestamps; require a full verification rerun after repairs or affected shared changes.
- Maintain a small incident index for scoped memory retrieval and an evaluation corpus for the Skill itself.

## Impact paths

- `skills/openatdd`
- `bin`
- `tests`
- `evals`
- `README.md`
- `.openatdd`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | State machine and `approve-acceptance` gate | Transition tests |
| AC-02 | Solution parser, trace validator, and `approve-solution` gate | Contract tests |
| AC-03 | SHA-256 approval fingerprints | Tamper regression test |
| AC-04 | Evidence manifest and readiness validator | Readiness integration tests |
| AC-05 | Issue lifecycle and incident-memory writer | Repair-loop test |
| AC-06 | Approved-solution path overlap analysis | Cross-task integration test |
| AC-07 | Indexed incident metadata and scoped search | Memory search test |
| AC-08 | Standalone Skill scripts and npm shim | Skill and clean-project validation |
| AC-09 | JSON scenario corpus and Node test runner | Dev/regression/holdout evaluation run |

## Risks

- Markdown conventions must be strict enough to validate without turning cards into a heavy spec format.
- Filesystem timestamps alone are weak evidence, so readiness also stores and rechecks content digests.
- Path-overlap impact analysis is conservative and may intentionally over-select historical acceptance.
- Agent-behavior quality still needs human and model-based evaluation beyond deterministic safety gates.

## Deliberate exclusions

- No daemon, database, dashboard, hosted service, or mandatory Git integration.
- No automatic production deployment or external message sending.
- No mandatory TDD, Gherkin, framework, or multi-agent topology.

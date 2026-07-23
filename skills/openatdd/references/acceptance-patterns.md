# Acceptance patterns

Use only the sections relevant to the current task. Keep the card short and
express criteria as observable outcomes, not implementation details.

## Web journeys

Cover the real entry point, role, navigation, user action, visible result,
refresh or repeat behavior, and an important denial path. Use Playwright or the
available browser controller for deterministic interaction and screenshots.

## APIs

Cover authentication, request shape, response and error semantics, persisted
state, idempotency where relevant, and an unauthorized or invalid request.
Preserve request/response evidence with secrets removed.

## Files and exports

Open or parse the produced file. Check file type, row/page count, required
fields, encoding or timezone, representative values, totals, and access
control. A successful download alone is not acceptance.

## Multiple roles and permissions

Name each role. Check both UI affordances and server-side enforcement. Include
scope boundaries such as tenant, merchant, team, or ownership.

## State transitions

Cover the initial state, triggering action, resulting state, repeated action,
failure or cancellation, and recovery. Add idempotency and compensation when
events, payments, inventory, or retries are involved.

## Data migration and compatibility

Cover representative old data, migrated data, rollback or recovery evidence,
public contracts, and mixed-version behavior. Treat irreversible changes as
high risk and require explicit authorization.

## Subjective or physical judgment

Classify visual comfort, real-device feel, legal review, finance approval,
hardware, CAPTCHA, or inaccessible third-party steps as `ASSISTED` or `MANUAL`.
Collect the best available evidence without claiming that AI completed the
human judgment.

## Risk expansion

Expand the default card only for money, permissions, privacy, security,
irreversible data, public API compatibility, high concurrency, large data,
third-party cost, or production operations. Add targeted criteria; do not add
new process stages.

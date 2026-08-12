# OpenATDD invariants

## INV-001 Separate approval gates

Acceptance must be approved before a formal solution is created, and the
solution must be approved before product code is changed.

## INV-002 Approved contract sections are immutable

Approved acceptance and solution sections cannot change without explicitly
reopening the corresponding gate. Delivery-section updates do not invalidate
either contract.

## INV-003 Readiness requires fresh evidence

No blocking automatic criterion can be delivered without evidence captured
after solution approval.

## INV-004 Repairs invalidate previous verification

After a defect is repaired, the complete affected acceptance chain must be
verified again. A local recheck alone is not sufficient.

## INV-005 One task, one visible file

Each task has exactly one worktree artifact:
`.openatdd/requirements/<task-id>.md`. State, evidence, indexes, observations,
transactions, and recovery artifacts live in Git-private OpenATDD storage.

## INV-006 Human acceptance stays explicit

Only AUTO acceptance can be finalized as passed automatically. Blocking
ASSISTED and MANUAL criteria remain waiting for human judgment until an explicit
human confirmation is recorded.

## INV-007 Finalization is reproducible

Formal finalization freezes product source, runs one broad group and one complete
approved journey, preserves fresh evidence, and reruns affected history after
repairs or shared-path changes.

## INV-008 Secrets never enter persisted artifacts

Credential values stay in `.env.openatdd.local`. Persisted documents, state,
evidence, logs, indexes, and notifications may contain variable names only and
must be scanned for leaks.

## INV-009 Human-facing language follows the requirement

Templates and delivery content follow the requirement and solution language
without a separate language prompt or flag.

## INV-010 Machine indexes remain rebuildable

Graph, context, observations, incident indexes, and replay caches are derived
runtime data. Their absence must never weaken deterministic contract or path
checks.

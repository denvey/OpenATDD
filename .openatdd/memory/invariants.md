# OpenATDD invariants

## INV-001 Separate approval gates

Acceptance must be approved before a formal solution is created, and the
solution must be approved before product code is changed.

## INV-002 Approved contracts are immutable

An approved acceptance or solution card cannot change without explicitly
reopening the corresponding gate.

## INV-003 Readiness requires fresh evidence

No blocking automatic criterion can enter `READY_FOR_UAT` without evidence
captured after solution approval.

## INV-004 Repairs invalidate previous verification

After a defect is repaired, the complete affected acceptance chain must be
verified again. A local recheck alone is not sufficient.

## INV-2026-001

After a repair, every non-deferred acceptance result must become affected before reverification

Protection: regression-repair-invalidates-chain-001

## INV-2026-002

CLI self-execution detection must compare canonical real filesystem paths

Protection: regression-portable-cli-realpath-001, standalone-skill-copy integration test

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

## INV-2026-003

Every CLI option that changes persisted verification semantics must be forwarded by its owning command and covered by a real-process regression test

Protection: CLI check forwards scope, source fingerprint, and duration

## INV-2026-004

Every local link emitted into a task report must be computed relative to the report directory and validated to remain inside the project root

Protection: detailed handoff renders project-level observations evidence as ../../environments/observations.json

## INV-2026-005

Historical finalization treats an absent runtime cache as an empty cache; cache presence is never a prerequisite for delivery.

Protection: affected history initializes a missing reverification index and recreates it atomically

## INV-2026-006

Human-facing artifacts follow the conversation language carried by requirement and solution content without a language flag, configuration, or selection prompt.

Protection: human-facing templates and reports infer Chinese without a language option

## INV-2026-007

Only AUTO acceptance can be finalized as passed; ASSISTED and MANUAL always remain explicit human judgments.

Protection: formal finalization keeps ASSISTED and MANUAL criteria manual and rejects ASSISTED self-pass

## INV-2026-008

A solution can pass review only when its complete human summary precedes details and every required review check is bound to the current hash and reviewer evidence.

Protection: solution summary order, six structured review checks, and independent scoped-review dispatch are enforced

## INV-2026-009

Every resumed delivery action and fresh-context Agent receives the current source-hashed implementation or verification view before work continues.

Protection: resume, repair attempts, and Agent dispatch restore and record source-hashed scoped context

## INV-2026-010

Relevant standards, research, and canonical invariant relationships remain source-hashed, rebuildable inputs to context and impact analysis.

Protection: standards and research enter scoped graph context and shared invariant content derives task impacts without path overlap

## INV-2026-011

A formal real-Agent claim requires repeated hidden-check evidence from the bundled real-model adapter; mock or partial-pass reports never satisfy it.

Protection: bundled Codex primary and bare adapters run twice and finalization verifies a 100-percent primary real-model report

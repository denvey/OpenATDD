# Issues: openatdd-1-0

## ISSUE-001 [resolved] AC-03

- Symptom: Chinese conversations still receive English template and UAT report labels even though no language option should be required.
- Root cause: Human-facing templates, contract aliases, and report rendering were hard-coded to English instead of deriving display language from the current requirement and solution artifacts.
- Regression protection: human-facing templates and reports infer Chinese without a language option
- Invariant: Human-facing artifacts follow the conversation language carried by requirement and solution content without a language flag, configuration, or selection prompt.
- Memory: INC-2026-006

## ISSUE-002 [resolved] AC-01

- Symptom: Formal finalization marks ASSISTED criteria passed before the required human judgment and evidence boundary is complete.
- Root cause: Finalization collapsed prepared evidence and required human judgment into one passed status for every criterion classification.
- Regression protection: formal finalization keeps ASSISTED and MANUAL criteria manual and rejects ASSISTED self-pass
- Invariant: Only AUTO acceptance can be finalized as passed; ASSISTED and MANUAL always remain explicit human judgments.
- Memory: INC-2026-007

## ISSUE-003 [resolved] AC-03

- Symptom: The solution summary order and review gate do not deterministically enforce risks, exclusions, consistency, or independent reviewer evidence.
- Root cause: The solution contract checked named sections but not their progressive order, and a free-form review lacked complete checks and independent reviewer provenance.
- Regression protection: solution summary order,six structured review checks,and independent scoped-review dispatch are enforced
- Invariant: A solution can pass review only when its complete human summary precedes details and every required review check is bound to the current hash and reviewer evidence.
- Memory: INC-2026-008

## ISSUE-004 [resolved] AC-05

- Symptom: Resumed repairs and dispatched fresh-context agents are not automatically supplied the scoped implementation or verification context.
- Root cause: Resume, repair, and Agent dispatch recorded control state but did not invoke one shared scoped-context loader for the appropriate surface.
- Regression protection: resume,repair attempts,and Agent dispatch restore and record source-hashed scoped context
- Invariant: Every resumed delivery action and fresh-context Agent receives the current source-hashed implementation or verification view before work continues.
- Memory: INC-2026-009

## ISSUE-005 [resolved] AC-04

- Symptom: The semantic graph does not ingest project standards or research and does not derive shared-invariant task impacts automatically.
- Root cause: Graph discovery omitted standards and research directories, while invariants were keyed by incident identity instead of canonical content.
- Regression protection: standards and research enter scoped graph context and shared invariant content derives task impacts without path overlap
- Invariant: Relevant standards, research, and canonical invariant relationships remain source-hashed, rebuildable inputs to context and impact analysis.
- Memory: INC-2026-010

## ISSUE-006 [resolved] AC-07

- Symptom: The release finalization claims Agent evaluation coverage without a persisted report from an actual model and bare-agent comparison.
- Root cause: Formal acceptance relied on mock evaluation tests because no bundled real-model adapter, persisted-report verifier, or pass-rate guard existed.
- Regression protection: bundled Codex primary and bare adapters run twice and finalization verifies a 100-percent primary real-model report
- Invariant: A formal real-Agent claim requires repeated hidden-check evidence from the bundled real-model adapter; mock or partial-pass reports never satisfy it.
- Memory: INC-2026-011


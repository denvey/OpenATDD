# Issues: detailed-uat-handoff

## ISSUE-001 [resolved] AC-07

- Symptom: CLI check options --scope, --source-fingerprint, and --duration-ms are ignored and persisted as broad/unspecified
- Root cause: The CLI wiring patch forwarded scoped-check options from the acceptance-record branch instead of the check branch, so recordCheck received no scope, fingerprint, or duration
- Regression protection: CLI check forwards scope,source fingerprint,and duration
- Invariant: Every CLI option that changes persisted verification semantics must be forwarded by its owning command and covered by a real-process regression test
- Memory: INC-2026-003

## ISSUE-002 [resolved] AC-01

- Symptom: Acceptance summary renders project-level evidence links relative to the task directory, so observations.json opens a missing path
- Root cause: The report summary reused project-root evidence paths directly even though report.md is nested under the task directory; the handoff renderer used a correct task-relative helper but resultTable did not
- Regression protection: detailed handoff renders project-level observations evidence as ../../environments/observations.json
- Invariant: Every local link emitted into a task report must be computed relative to the report directory and validated to remain inside the project root
- Memory: INC-2026-004


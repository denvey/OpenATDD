# Issues: openatdd-mvp

## ISSUE-001 [resolved] AC-05

- Symptom: A repaired failed criterion remained failed instead of becoming affected for full-chain reverification
- Root cause: Verification invalidation only selected passed and manual statuses, excluding the failed criterion that triggered repair
- Regression protection: regression-repair-invalidates-chain-001
- Invariant: After a repair, every non-deferred acceptance result must become affected before reverification
- Memory: INC-2026-001

## ISSUE-002 [resolved] AC-08

- Symptom: A copied Skill CLI could exit silently when macOS exposed the same temporary path through /var and /private/var aliases
- Root cause: Direct execution detection compared unresolved URL strings instead of canonical filesystem paths
- Regression protection: regression-portable-cli-realpath-001,standalone-skill-copy integration test
- Invariant: CLI self-execution detection must compare canonical real filesystem paths
- Memory: INC-2026-002


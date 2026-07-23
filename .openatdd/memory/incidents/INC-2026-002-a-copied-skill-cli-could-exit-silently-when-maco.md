# INC-2026-002: A copied Skill CLI could exit silently when macOS exposed the same temporary path through /var and /private/var aliases

- Area: skills/openatdd/scripts/openatdd.mjs
- Source task: openatdd-mvp
- Source issue: ISSUE-002
- Created: 2026-07-23T05:08:36.339Z

## Root cause

Direct execution detection compared unresolved URL strings instead of canonical filesystem paths

## Invariant

INV-2026-002: CLI self-execution detection must compare canonical real filesystem paths

## Regression protection

- regression-portable-cli-realpath-001
- standalone-skill-copy integration test

## Impact paths

- `skills/openatdd/scripts/openatdd.mjs`

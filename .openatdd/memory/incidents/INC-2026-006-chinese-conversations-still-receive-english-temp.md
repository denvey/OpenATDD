# INC-2026-006: Chinese conversations still receive English template and UAT report labels even though no language option should be required.

- Area: skills/openatdd/scripts/contracts.mjs
- Source task: openatdd-1-0
- Source issue: ISSUE-001
- Created: 2026-07-24T00:46:07.452Z

## Root cause

Human-facing templates, contract aliases, and report rendering were hard-coded to English instead of deriving display language from the current requirement and solution artifacts.

## Invariant

INV-2026-006: Human-facing artifacts follow the conversation language carried by requirement and solution content without a language flag, configuration, or selection prompt.

## Regression protection

- human-facing templates and reports infer Chinese without a language option

## Impact paths

- `skills/openatdd/scripts/contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/lib.mjs`
- `tests/workflow.test.mjs`

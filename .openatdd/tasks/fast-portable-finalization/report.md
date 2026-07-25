# Pre-UAT report: fast-portable-finalization

## Start here

- Version: 0.3.0
- Environment: local
- Role: n/a
- Safe account reference: n/a (no login required)
- Entry point: Open report.md.
- Estimated time: 12 minutes
- Verification epoch: 3

### Prerequisites

- Start or verify with: npm run check

## Step-by-step human acceptance

Complete the steps in order. If one fails, return its step number, the observed result, and any screenshot; do not continue guessing.

### Step 1 — AC-01: Every project receives the same portable execution contract

- Precondition: A CLI, API, Web, file, or mixed-surface repository has initialized OpenATDD.
- Action: A task enters implementation after the two existing approvals.
- Expected result: OpenATDD resolves a versioned project-local finalization manifest with applicable commands, surfaces, paths, evidence routes, budgets, and explicit not-applicable reasons; the contract works from a copied or symlinked Skill with Node.js 20+ and no new runtime dependency.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md), [batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md), [batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md)

### Step 2 — AC-02: Dry-run catches delivery defects before formal evidence

- Precondition: Implementation appears complete but the source has not been formally frozen.
- Action: OpenATDD runs `finalize --dry-run`.
- Expected result: It invokes the real configured entry points in a disposable or non-mutating context, validates CLI option wiring, environment and credential references, UAT coverage, report rendering, secret scanning, and every applicable local/URL link; it writes actionable preview diagnostics but creates no formal passes, clean epoch, READY state, notification, or affected-history reverification.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md)

### Step 3 — AC-03: The freeze fingerprint represents the complete deliverable

- Precondition: Dry-run is green and the implementation is ready for final verification.
- Action: OpenATDD freezes the source for finalization.
- Expected result: The fingerprint deterministically covers relevant tracked, modified, and untracked deliverable files while excluding Git metadata, local credentials, caches, and OpenATDD runtime evidence; any included-file change during or after finalization aborts or invalidates that run before READY.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md)

### Step 4 — AC-04: One validated manifest replaces serial evidence bookkeeping

- Precondition: The final source fingerprint is stable.
- Action: OpenATDD runs `finalize` with the validated manifest.
- Expected result: A single top-level operation executes final preflight, required focused/module/broad checks, cohesive UAT batches, acceptance mapping, evidence capture, secret scan, handoff preparation, and readiness validation; all inputs are validated before state is committed, and a failed operation cannot leave a partially passed finalization.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)

### Step 5 — AC-05: Repairs occur at the cheapest safe stage

- Precondition: A defect is found before or after the freeze boundary.
- Action: OpenATDD routes the repair.
- Expected result: Pre-freeze failures return to focused repair without invalidating formal evidence that does not yet exist; post-freeze failures use the issue/root-cause/regression/invariant flow, advance the epoch, and require exactly one new final run of the complete journey for the changed fingerprint.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)

### Step 6 — AC-06: Historical acceptance is reverified once per final fingerprint

- Precondition: Shared impact analysis identifies affected historical criteria.
- Action: Implementation and dry-run iterate before the final fingerprint stabilizes.
- Expected result: OpenATDD reports the pending historical scope but defers formal reverification; finalization batches the affected criteria once after the final source passes, records the fingerprint used, reuses a valid result for the same fingerprint, and invalidates it if relevant source changes.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)

### Step 7 — AC-07: The standard measures and prevents avoidable repetition

- Precondition: Projects vary greatly in build and UAT duration.
- Action: OpenATDD completes or retries a task.
- Expected result: It reports wall time, tool/CLI invocations, browser round trips, broad-check runs, final-journey runs, history reruns, and evidence writes by phase; on the happy path each final fingerprint permits one broad suite, one complete UAT journey, and one affected-history pass, while budget excess emits actionable warnings without failing acceptance solely because time elapsed.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)

### Step 8 — AC-08: The optimized workflow remains understandable and backward compatible

- Precondition: Existing projects and agents use the current individual OpenATDD commands.
- Action: The fast finalization standard is installed or an older task is resumed.
- Expected result: Existing commands and schema-v1/v2 tasks remain readable and usable; the Skill explains the default fast path, the manifest, dry-run diagnostics, fallback/manual commands, and final report links concisely enough to transfer to another repository without project-specific instructions.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm prepared evidence and observable result.
- Prepared evidence: [check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-3/check-module-evaluations-module-eval-suite.md), [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md), [batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md), [batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md)

## Relevant links

- [Detailed UAT report](report.md)
- [Approved acceptance card](acceptance.md)
- [Approved solution card](solution.md)
- [Issue and repair log](issues.md)
- [local environment profile](../../environments/local.yaml)
- [Finalization manifest](../../finalization.json)
- [Project documentation](../../../README.md)
- [AC-01 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-01 evidence: batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md)
- [AC-01 evidence: batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md)
- [AC-01 evidence: batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md)
- [AC-02 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-02 evidence: batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md)
- [AC-03 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-03 evidence: batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md)
- [AC-04 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-04 evidence: batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)
- [AC-05 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-05 evidence: batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)
- [AC-06 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-06 evidence: batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)
- [AC-07 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-07 evidence: batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md)
- [AC-08 evidence: check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-3/check-module-evaluations-module-eval-suite.md)
- [AC-08 evidence: check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md)
- [AC-08 evidence: batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md)
- [AC-08 evidence: batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md)
- [AC-08 evidence: batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md)

## Delivery evidence summary

- Requirement: Standardize a portable fast OpenATDD execution path that completes pre-freeze validation, batch finalization, and one-time historical reverification without weakening evidence.
- Phase: READY_FOR_UAT
- Acceptance approved: 2026-07-23T10:59:27.144Z
- Solution approved: 2026-07-23T12:18:43.602Z
- Ready at: 2026-07-23T12:46:34.922Z

### Acceptance results

| Acceptance | Class | Blocking | Status | Evidence |
|---|---|---:|---|---|
| AC-01 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md), [batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md), [batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md) |
| AC-02 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md) |
| AC-03 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-rehearsal-and-freeze-uat-rehearsal-freeze.md](evidence/finalize/epoch-3/batch-rehearsal-and-freeze-uat-rehearsal-freeze.md) |
| AC-04 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md) |
| AC-05 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md) |
| AC-06 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md) |
| AC-07 | AUTO | yes | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-atomic-history-metrics-uat-atomic-history-metrics.md](evidence/finalize/epoch-3/batch-atomic-history-metrics-uat-atomic-history-metrics.md) |
| AC-08 | AUTO | yes | passed | [check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-3/check-module-evaluations-module-eval-suite.md), [check-broad-project-broad-project-check.md](evidence/finalize/epoch-3/check-broad-project-broad-project-check.md), [batch-portable-contract-uat-portable-contract.md](evidence/finalize/epoch-3/batch-portable-contract-uat-portable-contract.md), [batch-portable-contract-uat-package-dry-run.md](evidence/finalize/epoch-3/batch-portable-contract-uat-package-dry-run.md), [batch-portable-contract-uat-official-skill-validation.md](evidence/finalize/epoch-3/batch-portable-contract-uat-official-skill-validation.md) |

### Project checks

- Finalization focused regression tests [focused]: **passed** — `node --test tests/finalization.test.mjs` — 1284 ms
- OpenATDD evaluation corpus [module]: **passed** — `npm run eval` — 817 ms
- Complete OpenATDD project checks [broad]: **passed** — `npm run check` — 1511 ms

### Repairs

- ISSUE-001: The finalizer assumed the v0.3 reverification cache index had already been created, but resumed legacy repositories can predate that runtime artifact. (INC-2026-005)

### Affected historical acceptance

- detailed-uat-handoff: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- openatdd-mvp: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09

### Human judgment

No manual acceptance criteria remain.

### Performance observations

- Environment preflight: 0 ms
- Estimated browser round trips: 3
- ACCEPTANCE_DRAFT: 143503 ms
- ACCEPTANCE_APPROVED: 32 ms
- SOLUTION_DRAFT: 4756426 ms
- CONTRACT_APPROVED: 43 ms
- IMPLEMENTING: 1591034 ms
- REPAIRING: 45811 ms
- PRE_UAT: 34432 ms

# Acceptance card: portable fast finalization

## Goal

After the normal acceptance and solution approvals, any project can follow one
portable OpenATDD execution standard that catches delivery defects before formal
evidence, freezes the real source once, finalizes verification in bulk, and
reverifies history once per final fingerprint—without weakening coverage or
adding another human gate.

## Suggested user journey

1. Approve the normal acceptance card and solution card.
2. Let OpenATDD select or validate a project-local execution profile for the task surface and risk.
3. Implement and repair with focused checks while accumulating no formal passed evidence.
4. Run one pre-freeze dry-run that exercises real CLI/API/Web entry points, renders a preview handoff, and validates every local or URL link.
5. Repair all dry-run findings, then freeze one complete source fingerprint only after the rehearsal is green.
6. Run one manifest-driven finalization that performs final preflight, ordered checks, cohesive UAT, evidence recording, handoff generation, and one-time affected-history reverification.
7. Open the generated report, review timing and repetition metrics, and execute the prepared human UAT steps.

## Criteria

### AC-01 [AUTO] [BLOCKING] Every project receives the same portable execution contract
- Given: A CLI, API, Web, file, or mixed-surface repository has initialized OpenATDD.
- When: A task enters implementation after the two existing approvals.
- Then: OpenATDD resolves a versioned project-local finalization manifest with applicable commands, surfaces, paths, evidence routes, budgets, and explicit not-applicable reasons; the contract works from a copied or symlinked Skill with Node.js 20+ and no new runtime dependency.
- Evidence: Clean-project fixtures for CLI, API, Web, and mixed surfaces; schema validation; copied-Skill and npm-linked CLI integration tests.

### AC-02 [AUTO] [BLOCKING] Dry-run catches delivery defects before formal evidence
- Given: Implementation appears complete but the source has not been formally frozen.
- When: OpenATDD runs `finalize --dry-run`.
- Then: It invokes the real configured entry points in a disposable or non-mutating context, validates CLI option wiring, environment and credential references, UAT coverage, report rendering, secret scanning, and every applicable local/URL link; it writes actionable preview diagnostics but creates no formal passes, clean epoch, READY state, notification, or affected-history reverification.
- Evidence: Regression fixtures for ignored CLI options, missing report targets, wrong workspace/port/login/organization/fixture, leaked secrets, incomplete UAT coverage, and a successful preview with unchanged formal task state.

### AC-03 [AUTO] [BLOCKING] The freeze fingerprint represents the complete deliverable
- Given: Dry-run is green and the implementation is ready for final verification.
- When: OpenATDD freezes the source for finalization.
- Then: The fingerprint deterministically covers relevant tracked, modified, and untracked deliverable files while excluding Git metadata, local credentials, caches, and OpenATDD runtime evidence; any included-file change during or after finalization aborts or invalidates that run before READY.
- Evidence: Fingerprint tests for tracked/untracked changes, exclusions, cross-platform path order, mid-run mutation, unchanged reruns, and secret-file omission.

### AC-04 [AUTO] [BLOCKING] One validated manifest replaces serial evidence bookkeeping
- Given: The final source fingerprint is stable.
- When: OpenATDD runs `finalize` with the validated manifest.
- Then: A single top-level operation executes final preflight, required focused/module/broad checks, cohesive UAT batches, acceptance mapping, evidence capture, secret scan, handoff preparation, and readiness validation; all inputs are validated before state is committed, and a failed operation cannot leave a partially passed finalization.
- Evidence: End-to-end success, validation failure, command failure, atomic rollback, resumed retry, and equivalence tests against the existing individual CLI commands.

### AC-05 [AUTO] [BLOCKING] Repairs occur at the cheapest safe stage
- Given: A defect is found before or after the freeze boundary.
- When: OpenATDD routes the repair.
- Then: Pre-freeze failures return to focused repair without invalidating formal evidence that does not yet exist; post-freeze failures use the issue/root-cause/regression/invariant flow, advance the epoch, and require exactly one new final run of the complete journey for the changed fingerprint.
- Evidence: State-machine tests for pre-freeze retries, post-freeze issue repair, epoch advancement, stale-evidence rejection, and complete final rerun.

### AC-06 [AUTO] [BLOCKING] Historical acceptance is reverified once per final fingerprint
- Given: Shared impact analysis identifies affected historical criteria.
- When: Implementation and dry-run iterate before the final fingerprint stabilizes.
- Then: OpenATDD reports the pending historical scope but defers formal reverification; finalization batches the affected criteria once after the final source passes, records the fingerprint used, reuses a valid result for the same fingerprint, and invalidates it if relevant source changes.
- Evidence: Multi-task tests proving no early history reruns, one batched final reverification, same-fingerprint reuse, changed-fingerprint invalidation, and readiness blocking when history remains incomplete.

### AC-07 [AUTO] [BLOCKING] The standard measures and prevents avoidable repetition
- Given: Projects vary greatly in build and UAT duration.
- When: OpenATDD completes or retries a task.
- Then: It reports wall time, tool/CLI invocations, browser round trips, broad-check runs, final-journey runs, history reruns, and evidence writes by phase; on the happy path each final fingerprint permits one broad suite, one complete UAT journey, and one affected-history pass, while budget excess emits actionable warnings without failing acceptance solely because time elapsed.
- Evidence: Deterministic counters, budget-warning tests, unchanged-source deduplication, retry metrics, and evaluations comparing the same journey with and without bulk finalization.

### AC-08 [AUTO] [BLOCKING] The optimized workflow remains understandable and backward compatible
- Given: Existing projects and agents use the current individual OpenATDD commands.
- When: The fast finalization standard is installed or an older task is resumed.
- Then: Existing commands and schema-v1/v2 tasks remain readable and usable; the Skill explains the default fast path, the manifest, dry-run diagnostics, fallback/manual commands, and final report links concisely enough to transfer to another repository without project-specific instructions.
- Evidence: Migration and compatibility tests, official Skill validation, README examples, package dry-run, and representative dev/regression/holdout evaluations.

## Boundaries

- Preserve exactly two normal human approvals: acceptance and solution.
- Optimize repeated work and protocol round trips, not the evidence standard or approved user journey.
- Do not promise one universal minute target; project commands may legitimately be slow. Use portable repetition limits and phase budgets instead.
- Keep focused checks available during implementation and retain existing granular CLI commands as a fallback and debugging surface.
- Do not reverify historical acceptance before the final fingerprint unless an explicit user request requires it.
- Keep dry-run non-production, non-deploying, non-notifying, and free of formal passed evidence.
- Do not add a hosted service, dashboard, mandatory subagent topology, production mutation, or new runtime package dependency.
- Do not commit, push, deploy, or send external notifications without separate authorization.

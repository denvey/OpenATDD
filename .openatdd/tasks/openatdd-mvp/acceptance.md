# Acceptance card: OpenATDD MVP

## Goal

A developer can invoke a lightweight Codex Skill, approve acceptance and a
solution in two separate short interactions, and then let the agent deliver an
evidence-backed pre-UAT result without adopting a heavyweight spec framework.

## Suggested user journey

1. Invoke `$openatdd` with a one-line requirement in an existing project.
2. Review and approve the AI-recommended acceptance card.
3. Review and approve the solution card derived from that acceptance.
4. Let the agent implement, test, execute the approved journey, and repair failures.
5. Receive a report and notification draft only after all automatic blockers pass.

## Criteria

### AC-01 [AUTO] [BLOCKING] Acceptance is the first gate
- Given: A new one-line requirement has been submitted.
- When: OpenATDD starts the task.
- Then: It creates only an acceptance draft and refuses a formal solution until acceptance is approved.
- Evidence: CLI transition tests and generated task files.

### AC-02 [AUTO] [BLOCKING] Solution is the second gate
- Given: Acceptance has been approved.
- When: The agent drafts and approves a solution.
- Then: Every acceptance ID is traced to implementation and verification, and code execution is refused before approval.
- Evidence: Contract validation and transition tests.

### AC-03 [AUTO] [BLOCKING] Approved contracts cannot drift silently
- Given: Acceptance and solution hashes were approved.
- When: Either file is changed without reopening its gate.
- Then: Validation and delivery commands fail with a contract-drift error.
- Evidence: Tamper-detection regression test.

### AC-04 [AUTO] [BLOCKING] Readiness requires fresh evidence
- Given: Implementation and pre-UAT are complete.
- When: The task requests `READY_FOR_UAT`.
- Then: Every automatic blocker has fresh evidence, relevant checks pass, and manual judgments remain explicitly listed.
- Evidence: Readiness tests and generated report.

### AC-05 [AUTO] [BLOCKING] Repair creates durable protection
- Given: Pre-UAT finds a defect.
- When: The defect is resolved.
- Then: Root cause, regression protection, and invariant are recorded and prior verification is invalidated for a full-chain rerun.
- Evidence: Repair-loop test and incident memory entry.

### AC-06 [AUTO] [BLOCKING] Shared changes revalidate old acceptance
- Given: A new solution touches paths used by an earlier completed task.
- When: The solution is approved.
- Then: Related prior criteria become `affected`, are reported as dependencies, and block readiness until freshly reverified.
- Evidence: Cross-task impact regression test.

### AC-07 [AUTO] [BLOCKING] Project memory is scoped and searchable
- Given: Historical incidents and invariants exist.
- When: A related task starts.
- Then: The agent can retrieve relevant memory by term or path without loading all incident files.
- Evidence: Memory-index search test.

### AC-08 [AUTO] [BLOCKING] The Skill is portable and lightweight
- Given: Node.js 20 or newer and a target repository.
- When: The bundled Skill or npm CLI is used.
- Then: It runs without runtime dependencies and stores portable Markdown and JSON under `.openatdd/`.
- Evidence: Skill validation, syntax checks, and clean-project integration test.

### AC-09 [AUTO] [BLOCKING] OpenATDD evaluates itself
- Given: The Skill or workflow logic changes.
- When: The evaluation command runs.
- Then: Dev, regression, and holdout scenario sets execute with all hard safety invariants passing.
- Evidence: Evaluation test output.

## Boundaries

- The MVP targets Codex and general code repositories.
- Playwright is the default Web pre-UAT executor but is not a hard package dependency.
- External notifications are drafts unless the user explicitly authorizes a channel.
- Mobile, desktop, production deployment, dashboards, and mandatory multi-agent execution are out of scope.

# Acceptance card: UAT delivery v2

## Goal

After the existing acceptance and solution approvals, OpenATDD can reuse and
maintain project-specific UAT knowledge, verify the local environment, execute
the browser journey efficiently, collect only valid post-repair evidence, and
hand reviewers a detailed package they can follow immediately. This adds no
third human confirmation point.

## Suggested user journey

1. Submit a requirement and approve the normal acceptance card and solution card.
2. Let OpenATDD recall the relevant project environment, test accounts, fixtures, and known workarounds.
3. Let OpenATDD automatically verify the workspace, services, account, organization, fixture, and entry point.
4. Implement with focused checks first and run the final broad checks only after the code and issues stabilize.
5. Execute the approved browser journey in a few cohesive batches instead of many single-click interactions.
6. Resolve every issue, start a fresh verification epoch, and only then capture formal acceptance evidence.
7. Open the generated handoff, follow its numbered steps and prepared links, and return failed step numbers if repair is needed.

## Criteria

### AC-01 [AUTO] [BLOCKING] Final handoff contains detailed steps and prepared links
- Given: Automated pre-UAT has completed successfully.
- When: OpenATDD generates `report.md` and `notification.md`.
- Then: The package starts with version, environment, role, prerequisites, safe account reference, entry point, and estimated time; it provides ordered one-action-at-a-time steps with expected results and pass/fail checkboxes, plus descriptive links to applicable environment, build, code, report, issue, documentation, and evidence resources.
- Evidence: Report and notification fixture assertions covering required context, numbered steps, link resolution, and missing-link failures.

### AC-02 [AUTO] [BLOCKING] Project UAT environment becomes evidence-backed long-term memory
- Given: A project has reusable local or staging UAT facts, fixtures, and known workarounds.
- When: A task starts, preflight succeeds, or UAT discovers a verified change.
- Then: OpenATDD retrieves only relevant project memory, records sources and `last_verified_at`, automatically merges newly verified non-secret facts, marks conflicting facts stale instead of silently deleting history, and reuses the refreshed profile on later tasks.
- Evidence: Multi-task tests for scoped recall, evidence-backed updates, stale history, and successful reuse without repeating discovery.

### AC-03 [AUTO] [BLOCKING] Local test credentials load from a dedicated ignored env file
- Given: Local UAT requires a username, password, organization, or similar test-only value.
- When: OpenATDD prepares the login step.
- Then: Non-secret environment YAML references variables from `.env.openatdd.local`; an empty `.env.openatdd.example` can be committed; the real local file is Git-ignored; values are used at runtime but never copied to state, memory, reports, evidence, command output, or logs and are always represented as `[REDACTED]` outside the login action.
- Evidence: Credential-loading, Git-ignore, missing-variable, redaction, and artifact-secret-scan tests.

### AC-04 [AUTO] [BLOCKING] Environment preflight prevents avoidable UAT detours
- Given: The approved solution is ready for implementation or pre-UAT.
- When: OpenATDD runs automatic preflight without adding a human gate.
- Then: It verifies project/worktree identity, service ports, application version, start commands, login capability, role or organization, third-party configuration, entry URL, deterministic fixtures, and relevant known issues; failures produce an actionable list and formal browser UAT does not start until required checks pass.
- Evidence: Preflight tests for wrong workspace, occupied or mismatched ports, invalid login, wrong organization, missing integration configuration, invalid fixture, and a successful cached profile.

### AC-05 [AUTO] [BLOCKING] Browser UAT runs in cohesive batches
- Given: Preflight has produced an approved-journey execution plan.
- When: OpenATDD executes Web pre-UAT.
- Then: It groups setup and login, the primary business journey, and final readback/evidence into a small number of scripts; it reads DOM and captures screenshots at meaningful checkpoints or on failure instead of after every click; any failed batch can be narrowed for diagnosis without rerunning unrelated completed setup.
- Evidence: Browser-runner evaluations showing the same approved journey with materially fewer round trips, preserved assertions, checkpoint evidence, and isolated failure recovery.

### AC-06 [AUTO] [BLOCKING] Formal evidence is collected only after repairs finish
- Given: An acceptance failure has opened an issue or changed product code.
- When: Repair completes.
- Then: OpenATDD requires root cause, regression protection, and invariant, closes all issues, advances a verification epoch, invalidates earlier formal results, rejects passed acceptance records while an issue remains open, and captures the complete journey evidence only in the current clean epoch.
- Evidence: Regression tests for open-issue pass rejection, epoch advancement, stale evidence rejection, complete-chain rerun, and incident-memory creation.

### AC-07 [AUTO] [BLOCKING] Test and acceptance order minimizes repetition without weakening coverage
- Given: A task has focused affected paths and risk-proportionate checks.
- When: Implementation and repair iterate.
- Then: OpenATDD runs focused tests during edits, relevant module checks after repairs, broad tests and builds once after code freeze, and one final complete approved UAT journey; it records phase timing and warns when environment discovery or browser round trips exceed the configured budget without treating elapsed time alone as a quality failure.
- Evidence: Evaluation scenarios proving targeted-before-broad ordering, no redundant broad run after unchanged code, final coverage retention, timing metrics, and budget warnings.

## Boundaries

- Preserve exactly two normal human gates: acceptance approval and solution approval.
- Do not add a separate approval for preflight, UAT execution, evidence collection, or handoff generation.
- Keep environment and handoff artifacts in portable Markdown, YAML, dotenv, and JSON; do not require a dashboard.
- Never commit `.env.openatdd.local`, store real credentials in project memory, or expose secret values to the model-visible transcript.
- Require environment-specific links only when that surface applies; explicit “not applicable” with a reason is valid.
- Preserve contract immutability, fresh evidence, affected historical acceptance, repair memory, and complete main-journey verification.
- This change prepares notification content but does not authorize sending messages, deploying, or changing production data.

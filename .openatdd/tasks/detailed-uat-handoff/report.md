# Pre-UAT report: detailed-uat-handoff

## Start here

- Version: 0.2.0
- Environment: local
- Role: n/a
- Safe account reference: n/a (no login required)
- Entry point: Open the Detailed UAT report link below.
- Estimated time: 15 minutes
- Verification epoch: 5

### Prerequisites

- Start the application with: npm run check

## Step-by-step human acceptance

Complete the steps in order. If one fails, return its step number, the observed result, and any screenshot; do not continue guessing.

### Step 1 — AC-01: Final handoff contains detailed steps and prepared links

- Precondition: Automated pre-UAT has completed successfully.
- Action: OpenATDD generates `report.md` and `notification.md`.
- Expected result: The package starts with version, environment, role, prerequisites, safe account reference, entry point, and estimated time; it provides ordered one-action-at-a-time steps with expected results and pass/fail checkboxes, plus descriptive links to applicable environment, build, code, report, issue, documentation, and evidence resources.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [report-link-repair.txt](evidence/report-link-repair.txt), [focused-tests.txt](evidence/focused-tests.txt)

### Step 2 — AC-02: Project UAT environment becomes evidence-backed long-term memory

- Precondition: A project has reusable local or staging UAT facts, fixtures, and known workarounds.
- Action: A task starts, preflight succeeds, or UAT discovers a verified change.
- Expected result: OpenATDD retrieves only relevant project memory, records sources and `last_verified_at`, automatically merges newly verified non-secret facts, marks conflicting facts stale instead of silently deleting history, and reuses the refreshed profile on later tasks.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [environment-source.txt](evidence/environment-source.txt), [observations.json](../../environments/observations.json)

### Step 3 — AC-03: Local test credentials load from a dedicated ignored env file

- Precondition: Local UAT requires a username, password, organization, or similar test-only value.
- Action: OpenATDD prepares the login step.
- Expected result: Non-secret environment YAML references variables from `.env.openatdd.local`; an empty `.env.openatdd.example` can be committed; the real local file is Git-ignored; values are used at runtime but never copied to state, memory, reports, evidence, command output, or logs and are always represented as `[REDACTED]` outside the login action.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [focused-tests.txt](evidence/focused-tests.txt)

### Step 4 — AC-04: Environment preflight prevents avoidable UAT detours

- Precondition: The approved solution is ready for implementation or pre-UAT.
- Action: OpenATDD runs automatic preflight without adding a human gate.
- Expected result: It verifies project/worktree identity, service ports, application version, start commands, login capability, role or organization, third-party configuration, entry URL, deterministic fixtures, and relevant known issues; failures produce an actionable list and formal browser UAT does not start until required checks pass.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [preflight.json](preflight.json)

### Step 5 — AC-05: Browser UAT runs in cohesive batches

- Precondition: Preflight has produced an approved-journey execution plan.
- Action: OpenATDD executes Web pre-UAT.
- Expected result: It groups setup and login, the primary business journey, and final readback/evidence into a small number of scripts; it reads DOM and captures screenshots at meaningful checkpoints or on failure instead of after every click; any failed batch can be narrowed for diagnosis without rerunning unrelated completed setup.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [uat-plan.json](uat-plan.json), [focused-tests.txt](evidence/focused-tests.txt)

### Step 6 — AC-06: Formal evidence is collected only after repairs finish

- Precondition: An acceptance failure has opened an issue or changed product code.
- Action: Repair completes.
- Expected result: OpenATDD requires root cause, regression protection, and invariant, closes all issues, advances a verification epoch, invalidates earlier formal results, rejects passed acceptance records while an issue remains open, and captures the complete journey evidence only in the current clean epoch.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [cli-scope-repair.txt](evidence/cli-scope-repair.txt), [report-link-repair.txt](evidence/report-link-repair.txt)

### Step 7 — AC-07: Test and acceptance order minimizes repetition without weakening coverage

- Precondition: A task has focused affected paths and risk-proportionate checks.
- Action: Implementation and repair iterate.
- Expected result: OpenATDD runs focused tests during edits, relevant module checks after repairs, broad tests and builds once after code freeze, and one final complete approved UAT journey; it records phase timing and warns when environment discovery or browser round trips exceed the configured budget without treating elapsed time alone as a quality failure.
- Decision: [ ] Pass  [ ] Fail
- Judgment: Confirm the prepared evidence matches the expected result.
- Prepared evidence: [focused-tests.txt](evidence/focused-tests.txt), [module-evaluations.txt](evidence/module-evaluations.txt), [broad-checks.txt](evidence/broad-checks.txt)

## Relevant links

- [Detailed UAT report](report.md)
- [Approved acceptance card](acceptance.md)
- [Approved solution card](solution.md)
- [Issue and repair log](issues.md)
- [local environment profile](../../environments/local.yaml)
- [Build and version metadata](../../../package.json)
- [Primary changed code](../../../skills/openatdd/SKILL.md)
- [Project documentation](../../../README.md)
- local application entry: not applicable — This task has no browser entry URL.
- [AC-01 evidence: report-link-repair.txt](evidence/report-link-repair.txt)
- [AC-01 evidence: focused-tests.txt](evidence/focused-tests.txt)
- [AC-02 evidence: environment-source.txt](evidence/environment-source.txt)
- [AC-02 evidence: observations.json](../../environments/observations.json)
- [AC-03 evidence: focused-tests.txt](evidence/focused-tests.txt)
- [AC-04 evidence: preflight.json](preflight.json)
- [AC-05 evidence: uat-plan.json](uat-plan.json)
- [AC-05 evidence: focused-tests.txt](evidence/focused-tests.txt)
- [AC-06 evidence: cli-scope-repair.txt](evidence/cli-scope-repair.txt)
- [AC-06 evidence: report-link-repair.txt](evidence/report-link-repair.txt)
- [AC-07 evidence: focused-tests.txt](evidence/focused-tests.txt)
- [AC-07 evidence: module-evaluations.txt](evidence/module-evaluations.txt)
- [AC-07 evidence: broad-checks.txt](evidence/broad-checks.txt)

## Delivery evidence summary

- Requirement: At final delivery, prepare detailed step-by-step human acceptance instructions and all relevant links so reviewers can validate quickly.
- Phase: READY_FOR_UAT
- Acceptance approved: 2026-07-23T09:50:59.642Z
- Solution approved: 2026-07-23T09:56:39.809Z
- Ready at: 2026-07-23T10:35:22.194Z

### Acceptance results

| Acceptance | Class | Blocking | Status | Evidence |
|---|---|---:|---|---|
| AC-01 | AUTO | yes | passed | [report-link-repair.txt](evidence/report-link-repair.txt), [focused-tests.txt](evidence/focused-tests.txt) |
| AC-02 | AUTO | yes | passed | [environment-source.txt](evidence/environment-source.txt), [observations.json](../../environments/observations.json) |
| AC-03 | AUTO | yes | passed | [focused-tests.txt](evidence/focused-tests.txt) |
| AC-04 | AUTO | yes | passed | [preflight.json](preflight.json) |
| AC-05 | AUTO | yes | passed | [uat-plan.json](uat-plan.json), [focused-tests.txt](evidence/focused-tests.txt) |
| AC-06 | AUTO | yes | passed | [cli-scope-repair.txt](evidence/cli-scope-repair.txt), [report-link-repair.txt](evidence/report-link-repair.txt) |
| AC-07 | AUTO | yes | passed | [focused-tests.txt](evidence/focused-tests.txt), [module-evaluations.txt](evidence/module-evaluations.txt), [broad-checks.txt](evidence/broad-checks.txt) |

### Project checks

- delivery v2 focused tests [focused]: **passed** — `node --test tests/delivery-v2.test.mjs` — 176.340583 ms
- evaluation corpus [module]: **passed** — `npm run eval` — 253.679458 ms
- full package checks [broad]: **passed** — `npm run check` — 285.937958 ms
- skill and package validation [broad]: **passed** — `quick_validate.py skills/openatdd && npm pack --dry-run`
- source freeze boundary [focused]: **passed** — `verify repaired source fingerprint`
- report-link source boundary [focused]: **passed** — `verify final report-link source fingerprint`

### Repairs

- ISSUE-001: The CLI wiring patch forwarded scoped-check options from the acceptance-record branch instead of the check branch, so recordCheck received no scope, fingerprint, or duration (INC-2026-003)
- ISSUE-002: The report summary reused project-root evidence paths directly even though report.md is nested under the task directory; the handoff renderer used a correct task-relative helper but resultTable did not (INC-2026-004)

### Affected historical acceptance

- openatdd-mvp: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09

### Human judgment

No manual acceptance criteria remain.

### Performance observations

- Environment preflight: 1 ms
- Estimated browser round trips: 6
- IMPLEMENTING: 1541704 ms
- PRE_UAT: 114820 ms
- REPAIRING: 67850 ms
- PRE_UAT: 251743 ms
- READY_FOR_UAT: 36451 ms
- REPAIRING: 135247 ms
- PRE_UAT: 174538 ms

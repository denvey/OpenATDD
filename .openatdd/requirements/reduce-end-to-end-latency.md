# Requirement delivery: reduce-end-to-end-latency

<!-- openatdd:delivery -->
## Status and merge recommendation

- Status：Accepted
- Merge recommendation：Do not merge: scope drift exists

## Delivery conclusion

Automatic verification is complete for epoch 8.

## Human acceptance entry

There are no blocking MANUAL or ASSISTED items; a person does not need to repeat the automatic tests.

## Reviewer focus

- Scope drift：.openatdd/knowledge/invariants.md, skills/openatdd/scripts/orchestration-contracts.mjs, tests/orchestration.test.mjs
- Incomplete checks：none
- Rollback：Revert the actual changed files below and remove this task's Git-private runtime directory.

## Actual changes and acceptance summary

- M .openatdd/knowledge/invariants.md
- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/references/orchestration.md
- M skills/openatdd/scripts/agent-profiles.mjs
- M skills/openatdd/scripts/execution-contracts.mjs
- M skills/openatdd/scripts/finalization.mjs
- M skills/openatdd/scripts/orchestration-contracts.mjs
- M skills/openatdd/scripts/routing.mjs
- M skills/openatdd/scripts/strategy.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/finalization.test.mjs
- M tests/intelligence-integration.test.mjs
- M tests/intelligence.test.mjs
- M tests/orchestration-docs.test.mjs
- M tests/orchestration-workflow.test.mjs
- M tests/orchestration.test.mjs
- M tests/strategy.test.mjs
- A skills/openatdd/scripts/timing.mjs

### Worktree cleanup

- Result：completed
- Summary：cleaned 0, retained 0, failed 0

| Acceptance | Class | Status | Result summary |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
| AC-04 | AUTO | passed | Finalization manifest for AC-04 verified this automatic criterion. |
| AC-05 | AUTO | passed | Finalization manifest for AC-05 verified this automatic criterion. |
| AC-06 | AUTO | passed | Finalization manifest for AC-06 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# Acceptance card: reduce-end-to-end-latency

## Goal

Reduce OpenATDD end-to-end delivery latency by using the intended worker execution path, eliminating redundant Quick verification, failing reviewer capability checks early, and exposing stage-level timing without weakening acceptance or evidence guarantees.

## Suggested user journey

1. A user runs a Standard or Deep task through acceptance and solution approval, then begins implementation.
2. OpenATDD prepares bounded execution work for eligible Worker sessions, or records a concrete reason why the controller must execute sequentially.
3. Before any Reviewer or writable Worker is dispatched, the host capability and runtime identity are checked against the routed profile and isolation contract.
4. A Quick task finalizes a frozen candidate without rerunning equivalent verification, while retaining fresh blocking evidence, one broad check, and one real approved journey.
5. The user inspects status or the delivery report and can see where contract, implementation, repair, and verification time was spent.

## Criteria

### AC-01 [AUTO] [BLOCKING] Standard and Deep enter implementation with executable work routing
- Given: A Standard or Deep task has an approved acceptance card and approved solution.
- When: Implementation begins without a caller-supplied execution plan.
- Then: OpenATDD persists a validated Worker-ready execution plan that covers every acceptance criterion with bounded ownership and verification, or persists a specific `controller-sequential` reason when safe delegation cannot be derived.
- Evidence: Automated workflow tests and a task-state snapshot covering both the delegated and controller-sequential paths.

### AC-02 [AUTO] [BLOCKING] Routed controller and Reviewer profiles match the intended latency policy
- Given: A task is assessed as Quick, Standard, or Deep.
- When: Its controller profile is returned or its independent Reviewer contract is prepared.
- Then: Quick uses Sol with `high` reasoning; Standard and Deep use Sol with `xhigh` reasoning; Standard and Deep Reviewers use Sol with `xhigh` reasoning; and runtime attestations must match the selected profile.
- Evidence: Routing, profile, and attestation tests for all three lanes.

### AC-03 [AUTO] [BLOCKING] Unsupported Reviewer capability fails before dispatch work begins
- Given: A Deep solution requires independent review but the host cannot provide the selected Reviewer identity or runtime capability.
- When: OpenATDD performs the pre-dispatch capability check.
- Then: The task records one immediate unavailable/fallback-eligible outcome for that solution fingerprint without creating a running dispatch or consuming two futile runtime attempts; repeated checks are idempotent.
- Evidence: Integration tests showing one unavailable record, zero running Reviewer dispatches, no second retry, and the expected fallback eligibility.

### AC-04 [AUTO] [BLOCKING] Quick finalization does not execute equivalent verification twice
- Given: A Quick task has fresh command evidence for the same frozen source fingerprint.
- When: `finalize --fast` runs its rehearsal and formal delivery chain.
- Then: Equivalent deterministic checks are executed at most once across the chain, while successful delivery still has fresh blocking evidence, exactly one broad check, one complete automatic approved journey when automation exists, and any required affected-history pass.
- Evidence: Finalization tests and metrics proving command reuse or skips, one broad run, one journey run, and valid acceptance/history evidence.

### AC-05 [AUTO] [BLOCKING] Stage timing is visible and stable
- Given: A task advances through contract work, implementation, optional repair, and verification.
- When: The user reads task status, retrospective data, or the delivery report.
- Then: Each applicable stage exposes a non-negative duration with clear start/end semantics, repeated reads do not inflate it, and Worker, Reviewer, and finalization durations remain attributable to their stages.
- Evidence: State, status/report, retrospective, and timing regression tests using a deterministic clock.

### AC-06 [AUTO] [BLOCKING] Latency improvements preserve delivery safety and compatibility
- Given: Existing Quick, Standard, Deep, orchestration, review, and finalization callers use the public CLI and persisted task schema.
- When: The optimized paths run or reject unsafe input.
- Then: Existing compatible commands continue to work; writable Workers still require isolated worktrees and frozen shared contracts; acceptance/history/evidence freshness gates remain enforced; and OpenATDD never automatically commits, pushes, opens a PR, deploys, deletes branches, or falls back to shared-directory writes.
- Evidence: Existing and new regression tests for CLI compatibility, isolation, shared contracts, freshness, and prohibited side effects.

## Boundaries

- Core OpenATDD remains host-agnostic and does not call proprietary Codex APIs; host adapters execute the returned capability and session actions.
- Writable Workers never share the controller checkout or another writable Worker's worktree.
- Acceptance approval, solution approval, authorization, affected-history, evidence freshness, and formal journey guarantees are not weakened.
- Existing CLI and persisted-state compatibility is preserved where possible; any schema extension is additive and normalized for older tasks.
- Tasks a user intentionally runs without OpenATDD remain outside this workflow and are not counted as failed or partial OpenATDD runs.
- This change does not authorize automatic commits, pushes, pull requests, deployments, notifications, or branch/worktree deletion.
- General graph caching and whole-project fingerprint acceleration are excluded from this iteration unless required to make the accepted execution path correct.
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# Solution card: reduce-end-to-end-latency

<!-- openatdd:recommendation -->
## Recommendation

Make the existing execution contracts the default Standard/Deep implementation path instead of adding a new scheduler. At `begin`, derive one conservative isolated Worker task from the approved impact paths and project finalization commands; persist a concrete controller-sequential fallback when those inputs are not safely bounded. Let the existing orchestration adapter dispatch a single isolated Worker as well as parallel batches, add a permanent-capability fast-fail for Reviewers, reuse only exact deterministic Quick rehearsal evidence, and expose derived delivery-stage timing from existing timestamps and metrics.
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## Why this fits

- Reuses the current execution-plan schema, runtime attestations, host action protocol, finalization manifest, phase timestamps, and isolated-worktree checks.
- Fixes the missing connection between solution approval and Worker dispatch without putting Codex-specific API calls in core OpenATDD.
- Keeps uncertain planning with the Sol/xhigh controller: automatic delegation happens only when impact paths and deterministic verification commands form a valid bounded contract.
- Preserves the documented Quick high and Standard/Deep xhigh policy while retaining the unrelated in-progress documentation extraction into `references/orchestration.md`.
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## Main changes

- Add a pure default-plan derivation contract and additive execution fallback/next-action state; invoke it when Standard/Deep implementation begins and no explicit plan exists.
- Allow `orchestration-start` to produce create/send/wait/read actions for one isolated Worker without requiring the one-time parallel directive; keep the directive as a request to maximize only safe parallel batches.
- Treat pre-dispatch Reviewer `model_identity` and `permission` failures as one idempotent unavailable result, while retaining the existing two-attempt budget for transient runtime failures.
- Let Quick formal checks reuse rehearsal evidence only for the same frozen fingerprint, verification boundary, and exact deterministic command contract; continue to execute one broad check and one real UAT journey across the successful chain.
- Add derived contract/implementation/repair/verification timing to status, reports, and retrospectives, with Reviewer, Worker, and finalization attribution that does not mutate or double-count persisted phase timing.
- Restore Standard controller and Reviewer routing to Sol/xhigh and update focused regression tests and workflow documentation.
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## Risks

- **Unsafe automatic scope or command guesses:** default planning validates approved project-relative impact paths and resolved manifest commands; missing, protected, overlapping, or unbounded inputs persist a stable `controller-sequential` reason instead of dispatching.
- **Single Worker weakens isolation:** ordinary orchestration still capability-checks the host and requires a unique non-controller worktree, branch, thread, base identity, leaf runtime, and matching attestation.
- **Permanent and transient Reviewer failures are confused:** only host-proven model-identity or permission unavailability skips the retry; timeouts and other runtime failures retain the bounded two-attempt policy.
- **Rehearsal evidence becomes stale:** reuse is Quick-only, opt-in through `deterministic: true`, exact-contract matched, captured after the shared verification boundary, and rejected if source, manifest, or environment fingerprints drift.
- **Timing is inflated or double-counted:** stage totals derive from phase intervals once; Agent and finalization durations are exposed as attribution details rather than added again to stage totals.
- **Existing uncommitted work is overwritten:** edits remain path-local and preserve unrelated documentation and test changes already present in the working tree.
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## Deliberate exclusions

- No new daemon, queue, database, background scheduler, or proprietary Codex API call in the core.
- No automatic semantic decomposition of an approved solution into speculative multi-writer tasks.
- No shared-checkout writable Worker fallback and no relaxation of shared-contract requirements for actual parallel batches.
- No removal of preflight, broad verification, real UAT, affected-history, evidence freshness, authorization, or approval gates.
- No graph-cache or whole-project fingerprint redesign in this iteration.
- No automatic commit, push, PR, deployment, notification, branch deletion, or forced worktree cleanup.
<!-- /openatdd:exclusions -->

## Implementation

- Add `deriveDefaultExecutionPlan` beside the existing execution validators. It receives acceptance IDs, approved impact paths, lane, task goal, protected paths, and resolved finalization commands. It returns either a schema-v1 single Worker plan or a structured fallback `{ code, message, details }`; it never throws a normal inability-to-delegate as an unstructured planner failure.
- Extend normalized `execution` state with `fallbackReason` and `nextActions`. Explicit `plan-execution` clears fallback state. `beginImplementation` keeps an existing valid plan, otherwise derives and validates the default plan before returning `dispatch-worker` or `controller-sequential`.
- Generalize orchestration startup so a validated one-task plan yields one create/send/wait/read action set and an isolated session. Parallel directives remain solution-SHA-bound and require the frozen shared-interface contract only when two or more tasks will run concurrently.
- Short-circuit independent-review retry accounting after one pre-dispatch `model_identity` or `permission` failure, write one fingerprint/round unavailable key, and reject duplicate capability failures idempotently. Ordinary runtime failures keep the current two-attempt path.
- Store a rehearsal verification boundary and deterministic command signature in the preview. Formal Quick checks may capture and map that evidence instead of spawning the same command again; non-Quick, non-deterministic, mismatched, stale, broad/UAT-incomplete, or separately invoked evidence continues through the existing formal path.
- Add a small pure timing projection that groups persisted phases into contract, implementation, repair, and verification. Status/report/retrospective include totals plus Reviewer/Worker/finalization attribution; reads do not write state.
- Update Skill/governance/orchestration guidance so hosts do not manually rerun manifest-owned module, broad, or UAT commands before `finalize --fast`, and so a returned default Worker action is actually dispatched.

## Impact paths

- `skills/openatdd/scripts/execution-contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/strategy.mjs`
- `skills/openatdd/scripts/timing.mjs`
- `skills/openatdd/scripts/routing.mjs`
- `skills/openatdd/scripts/agent-profiles.mjs`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`
- `skills/openatdd/references/orchestration.md`
- `README.md`
- `tests/orchestration-workflow.test.mjs`
- `tests/intelligence-integration.test.mjs`
- `tests/intelligence.test.mjs`
- `tests/finalization.test.mjs`
- `tests/strategy.test.mjs`
- `tests/orchestration-docs.test.mjs`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | Default plan derivation, additive fallback state, and single isolated Worker orchestration | Workflow/orchestration tests for derived plan, host actions, and controller-sequential reasons |
| AC-02 | Restore Quick high and Standard/Deep controller/Reviewer xhigh profiles | Routing, profile, CLI status, and runtime-attestation tests |
| AC-03 | Permanent Reviewer capability fast-fail and idempotent unavailable key | Independent-review tests proving one failure, no running dispatch, no retry, and fallback eligibility |
| AC-04 | Shared-boundary deterministic rehearsal evidence reuse plus host guidance | Finalization tests proving exact-signature reuse, one broad satisfaction, one UAT journey, and fresh mapped evidence |
| AC-05 | Pure stage timing projection with Agent/finalization attribution | Deterministic-clock state, status/report, retrospective, and repeated-read tests |
| AC-06 | Existing validators and isolated host actions remain authoritative | Full CLI, orchestration, finalization, compatibility, documentation, and prohibited-side-effect regressions |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## Traceability notes

This area keeps verification, repair, and runtime-history summaries. Raw machine artifacts live in Git-private runtime storage.
<!-- /openatdd:details -->

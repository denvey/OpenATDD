# Multi-session execution

Read this reference only when delegating work to a separate session: a bounded
or complex implementation worker, an independent reviewer, or a real parallel
batch. Inline implementation does not load this reference.

## Roles and profiles

Keep the controller on the user's current conversation model and reasoning
setting. Follow the kernel's executor preferences for authorized delegation;
explicit user choices take precedence. Check support in the actual dispatch tool,
use a suitable available executor if needed, and report any substitution once.
These role profiles define responsibility and permissions, not model/effort
dispatch requirements. Record available actual runtime metadata without
substituting recommendations for unknown values. After solution approval,
the controller records a structured execution plan for useful, host-permitted
delegation; the user need not request it separately. Both implementation
routes remain leaf workers with `forkTurns:none` and
`canSpawnAgents=false`; they cannot create Agents or change acceptance,
solution, authorization, scheduling, shared state, integration, or final
verdicts. Each receives the exact prompt, `writeScope`, `doNotTouch`,
verification commands, evidence contract, base identity, and candidate
fingerprint it must honor, then returns only scope-bound changes, verification,
evidence, and the current candidate fingerprint.

Choose the fewest executors that can complete the work. Keep small changes with
already-understood context inline. Delegate one coherent, independently verifiable
outcome to one Worker; use two only for independent work with disjoint ownership
and an established interface contract. Split by business coupling and delivery
boundaries, not frontend/backend labels or a desire to use every preferred model.
Evaluate handoff, startup, context reconstruction, integration, and likely rework
against the expected implementation benefit before delegating.
Quick permits at most one bounded Worker; reassess work needing parallel execution.

Workers own implementation choices, focused tests, and ordinary repairs inside
their approved contract. Do not ask the controller to approve each local step.
Escalate contract changes, scope or permission conflicts, contradictory evidence,
or the no-progress condition below. Provide known code locations and current
evidence once; return changed paths, verification and evidence locators, and
unresolved issues rather than full transcripts. Reuse valid discovery instead of
repeating it for reassurance. Avoid extra scouts or reviewers unless required by
the lane, requested, or justified by a concrete risk. Use existing stage timings
to assess total delivery latency, not model response speed alone.

New tasks must first complete `begin`'s executable acceptance baseline. Its
frozen test files are added to every Worker `doNotTouch`, and dispatch/results/
integration verify baseline integrity. Correcting an acceptance test requires
reopening the solution and preparing a fresh baseline after approval.

The runtime allocates at most two implementation Workers before integration.
Larger stages run in bounded batches; dependencies and stage order are preserved.
Do not split work just to fill slots. Send the approved interface/error contract,
existing implementation examples, and exact acceptance assertions in the task.
After two no-progress repairs, return failure evidence for controller diagnosis;
the Worker resumes implementation after the plan is clarified. This repair limit is
a Worker instruction, not a timer or an automatic model invocation by the CLI.

## The one-time parallel directive

The directive is an optional user request to maximize safe parallelism, not a
prerequisite for a controller-selected Worker plan. Do not synthesize a user
parallel directive from a generic Skill invocation. Host authorization rules still
apply to every dispatch, including controller-selected plans.

If the person says “批准方案，并行执行” (or an unmistakable equivalent while
approving the solution), the controller records a one-time
`approve-solution TASK --begin --parallel` directive bound to the current
approved solution SHA. This is not project configuration and never carries to a
later solution or task. The controller still decides the actual safe parallel
batch from the approved `stage`, `dependsOn`, `writeScope`, `doNotTouch`, and
verification contracts; the request maximizes only safe parallelism and never
overrides a dependency, authorization, isolation, ownership, or verification
gate. If fewer than two tasks are safe, explain why and keep the approved
execution serial.

## Frozen shared interface contract

The controller is the sole contract, task-state, session-event, integration, and
verdict writer.

Before any writable session is created, a real parallel batch must also freeze
one controller-owned executable shared-interface contract. It names every
participating subtask, lists contract-test files outside all worker
`writeScope`s, and provides bounded zero-model commands. The controller runs
those commands before dispatch, hashes the files, sends the frozen result in
every worker prompt, and adds the files to every worker `doNotTouch`. A missing,
failing, uncovered, worker-owned, or later-drifting contract blocks dispatch,
result acceptance, and integration. This prevents individually green workers
from leaving event, schema, or API reconciliation to the controller.

## Host adapter order

A host adapter maps the core's create/send/wait/read actions to available,
authorized isolated-session tools in this order:

1. Capability-check session creation, messaging, waiting, result reading,
   and isolated-worktree support. Missing, unverifiable, or
   mismatched capability fails closed; do not fall back to shared-directory
   writes.
2. Create one isolated execution session per scheduled subtask, from the
   intended current working-tree state. Require unique `threadId`, worktree,
   branch, and base identity, and reject duplicates, missing identities, or a
   worktree equal to the controller checkout.
3. Send the exact worker prompt and ownership/
   verification contract.
4. Wait for the batch, preserving results for sessions that finish
   when another session fails or asks for input.
5. Read the structured terminal result and actual duration.
6. Only then call the controller-only `session-record`, `session-result`, and
   `orchestration-integrate` CLI operations. The core defines this adapter
   contract; it does not call Codex proprietary APIs directly.

Use `create_thread`, `send_message_to_thread`, `wait_threads`, and `read_thread`
only when the host permits task creation for this request. A host that reserves
user-visible tasks for explicit user requests must use authorized subagent or
CLI-session facilities instead. Never create sidebar tasks merely because this
reference names those APIs. Shared-directory subagents do not prove worktree
isolation. Unavailable permissions or isolation must be reported and block
delegation. A different or unknown model/effort does not block dispatch.

Failed, blocked, or `needs_input` sessions remain individually visible. Passed
sessions may be retained, but affected dependents and final integration wait for
controller replanning. A stale base, changed candidate fingerprint, range
violation, missing verification/evidence, or integration conflict is never a
PASS: keep other verified results, mark the session for conflict/replan, and
return to the controller for diagnosis and decomposition. Model substitution is
allowed; permission, scope, and isolation substitution is not.

## Integration budget

Controller integration has a default 15-minute soft budget per ready batch. The
clock starts only after the batch is terminal and at least one verified result is
ready—not while workers are implementing—and resets when a later dependency
batch becomes ready. After the budget is exceeded, normal integration and scope
expansion stop. The only permitted next actions are
`minimal-contract-repair`, `controller-sequential`, or `replan`; the selected
action is persisted and returned to the host instead of continuing an unbounded
merge/reconciliation loop.

## Isolation and cleanup

In every lane, `begin` defaults to single-session inline implementation.
Explicit parallel approval returns `plan-execution` until a safe plan exists;
`begin` preserves an already recorded Worker plan. The controller uses
`plan-execution` for useful, host-permitted bounded delegation without a separate
workflow approval. The controller may implement approved product code
without a separate model-specific authorization. An existing delegated plan
still requires its results or explicit replanning; inline execution cannot
silently discard its active sessions or verification obligations.
Loading a task preserves routing already bound into a Worker session's authority
fingerprint. Current model recommendations remain available through `model-policy`;
changing recommendations must not invalidate a session's unchanged contract.
Single and parallel writable work both require isolated
worktrees and proven ownership. The frozen shared-interface contract is required
only when a batch actually runs two or more Workers concurrently. Orchestration never
automatically commits, pushes, opens a PR, deploys, or deletes branches. After a
task reaches `DELIVERED`, the controller runs `orchestration-cleanup`: it may
remove only task-recorded, integrated worktrees whose immutable Git identity and
complete residual content are proven safe. It never uses `git worktree remove
--force`; unsafe or failed candidates are retained and reported.

## Commands

```bash
openatdd plan-execution TASK --input execution-plan.json
openatdd approve-solution TASK --begin --parallel
openatdd orchestration-start TASK --input host-capabilities.json --json
openatdd session-record TASK --input session-event.json
openatdd session-result TASK --input session-result.json
openatdd orchestration-integrate TASK --input integration.json
openatdd orchestration-cleanup TASK --json
openatdd agent-dispatch TASK --id AGENT-001 --role bounded-implementation \
  --subtask-id ST-001 --status running --attestation runtime.json
openatdd agent-result TASK --input execution-result.json
```

The input JSON files are transient caller inputs. OpenATDD persists the accepted
plan, session events, results, and integration decisions only in Git-private task
state; do not add a public plan artifact. `session-record`, `session-result`, and
`orchestration-integrate` are controller-only mutations even when the host adapter
is driving several Codex App threads. `orchestration-cleanup` is also
controller-only and is valid only after `DELIVERED`.

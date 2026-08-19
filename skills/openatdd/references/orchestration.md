# Multi-session execution

Read this reference only when delegating work to a separate session: a bounded
or complex implementation worker, an independent reviewer, or a real parallel
batch. Quick and controller-sequential delivery never loads it.

## Roles and profiles

Read-only discovery and research use Luna/low. Independent review uses a fresh
Sol/xhigh context for Standard and Deep. After solution approval, delegate only a structured
execution plan: `bounded-implementation` and `complex-implementation` both use
Luna/max. Both are leaf workers with `forkTurns:none` and
`canSpawnAgents=false`; they cannot create Agents or change acceptance,
solution, authorization, scheduling, shared state, integration, or final
verdicts. Each receives the exact prompt, `writeScope`, `doNotTouch`,
verification commands, evidence contract, base identity, and candidate
fingerprint it must honor, then returns only scope-bound changes, verification,
evidence, and the current candidate fingerprint.

## The one-time parallel directive

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

A Codex App host adapter maps the host actions in this order:

1. Capability-check `create_thread`, `send_message_to_thread`, `wait_threads`,
   and `read_thread`, plus isolated-worktree support. Missing, unverifiable, or
   mismatched capability fails closed; do not fall back to shared-directory
   writes.
2. `create_thread` once per subtask, starting each isolated worktree from the
   intended current working-tree state. Require unique `threadId`, worktree,
   branch, and base identity, and reject duplicates, missing identities, or a
   worktree equal to the controller checkout.
3. `send_message_to_thread` with the exact worker prompt and ownership/
   verification contract.
4. `wait_threads` for the batch, preserving results for sessions that finish
   when another session fails or asks for input.
5. `read_thread` to obtain the structured terminal result and actual duration.
6. Only then call the controller-only `session-record`, `session-result`, and
   `orchestration-integrate` CLI operations. The core defines this adapter
   contract; it does not call Codex proprietary APIs directly.

Failed, blocked, or `needs_input` sessions remain individually visible. Passed
sessions may be retained, but affected dependents and final integration wait for
controller replanning. A stale base, changed candidate fingerprint, range
violation, missing verification/evidence, or integration conflict is never a
PASS: keep other verified results, mark the session for conflict/replan, and
return to the routed Sol controller. Ambiguous or unbounded work also stays with
that controller; there is no silent worker-model fallback.

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

Quick remains controller-direct. Standard/Deep `begin` may return one default
Worker action when approved impact paths and manifest verification form a safe
bounded contract; the host must dispatch it rather than silently continuing in
the controller. Single and parallel writable work both require isolated
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

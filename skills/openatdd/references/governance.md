# Governance details

Read this reference only when a task has a material risk overlay, unresolved
human decision, Deep investigation, affected history, Agent dispatch, repeated
repair, or graph/context diagnosis. Routine Quick work does not load it.

## Risk and authorization

Complexity controls investigation depth. Risk overlays control safety and
verification; they never change Quick, Standard, or Deep by themselves.
Supported overlays include migration, authentication, authorization, payment,
privacy, security, external-service, deletion, production, irreversible,
public-compatibility, sensitive-boundary-change, shared-data-migration, and
external-side-effect.

Strengthen denial paths, redaction, rollback, compatibility, preflight, and
evidence only where the active overlay requires them. The `deletion`,
`production`, `irreversible`, `shared-data-migration`, and
`external-side-effect` overlays require a resolved human `authorization`
decision before product changes. The decision must list every covered overlay.
Project configuration may add authorization overlays but cannot remove built-in
ones. Reopening acceptance returns authorization decisions to pending.

## Human decisions

Discover repository facts first. Record only product, scope, cost, risk, or
authorization choices that the Agent cannot safely infer:

```bash
openatdd decision TASK --input decision.json
openatdd resolve-decision TASK --id DEC-001 --option OPTION --rationale "..."
```

Each decision has an owner, blocking status, one concise question, two or three
options with consequences, a recommendation, and a project-grounded basis.
Agent-owned implementation choices do not become user questions. Resolve every
blocking decision before acceptance approval.

## Investigation and Agents

- Quick: compact local work with one bounded Luna/max Worker; no routine scouts
  or external research.
- Standard: local discovery and optional independent read-only review when it
  materially reduces risk.
- Deep: parallel local discovery and relevant external research; add an
  independent solution review. Record unavailable research rather than silently
  treating Deep as Standard.

Design routing is explicit: Quick/Standard use GPT-6/medium, Deep uses
GPT-6/high. Acceptance uses medium by default, high for sensitive risk overlays
or explicit evidence/correctness concerns; complexity alone does not raise it.
The controller remains workspace-write for contracts and final
integration; read-only applies to scouts and independent reviewers.
Discovery and external research use Luna/low, read-only; independent review uses
a fresh GPT-6 context at the lane's design effort. Give every role a
bounded context and record a host runtime attestation matching model, reasoning
effort, sandbox, `forkTurns:none`, and leaf capability. Parent runtime overrides
remain authoritative, so an unverifiable or mismatched runtime fails closed.

Independent review is bounded by machine state, not only prose. A pre-dispatch
`model_identity` or `permission` failure is permanent for the selected
fingerprint/round: record one idempotent unavailable outcome and do not create a
running dispatch or consume a second attempt. Initial review otherwise uses
900000 ms. Actionable findings are a successful review result; after the
solution changes, one targeted recheck round uses 300000 ms. A transient runtime
failure (timeout, no response, unattached process, or equivalent) permits one fresh
Reviewer retry for the same solution fingerprint and round. A passed dispatch
must record actual duration within budget. A third attempt, duplicate result, or
over-budget PASS is rejected. After two runtime failures, ordinary Deep may use
an explicitly labelled main-review fallback; dangerous authorization overlays
require an explicit human fallback decision recorded with `openatdd
review-fallback TASK --status approved|denied --rationale "..."
--human-confirmed` before a main-review fallback may pass.

After solution approval, the controller in any lane may persist a structured
Git-private execution plan. If the person explicitly approves with language such
as “批准方案，并行执行”, the host records the one-time
`approve-solution TASK --begin --parallel` directive against only the current
solution SHA; it is not configuration. Without that request the controller may
still choose a safe batch when the contract permits it. With it, the controller
maximizes only safe parallelism from approved `stage`, `dependsOn`, `writeScope`,
`doNotTouch`, and verification contracts. Dependencies, authorization,
ownership, isolation, and verification gates always win; a plan with fewer than
two safe tasks remains serial and is explained before dispatch.

Route both bounded and complex work to Luna/max only when it is unambiguous,
scope-owned, and independently verifiable. Workers receive an exact prompt,
ownership, `writeScope`/`doNotTouch`, verification, evidence, base, and
fingerprint contract. They are leaves with `forkTurns:none` and
`canSpawnAgents=false`; they cannot change acceptance, solution, authorization,
scheduling, shared state, integration, or final verdicts. Their PASS must match
actual in-scope changed paths, every planned verification command, fresh
evidence, and the current candidate fingerprint. Lifecycle `completed` is never
a PASS. Work that cannot be safely bounded, or a worker result that is failed,
blocked, or materially ambiguous, returns to GPT-6 for diagnosis and replanning,
then Luna for implementation; there is no silent model fallback. After two
no-progress repairs, the Worker returns the failing assertion, relevant diff,
and rejected hypotheses. Direct GPT-6 implementation needs user authorization.

The controller is the sole contract/state/session-event/integration/verdict
writer. The adapter maps authorized isolated-session creation, messaging,
waiting, and result reading,
then invokes controller-only `session-record`, `session-result`, and
`orchestration-integrate`. The core remains host-agnostic and does not call
Codex proprietary APIs directly. Follow the host-specific tool and permission
rules in `orchestration.md`; user-visible task creation is not automatically
authorized by a Worker plan. Before creating a session, require proven
capabilities and unique `threadId`, worktree, branch, and base identity; missing,
duplicate, shared, or mismatched identities fail closed rather than enabling
shared-directory writes.

For every actual parallel batch, the controller must freeze and execute a shared
interface contract before session creation. The contract names all participating
task IDs, identifies controller-owned test files outside every worker
`writeScope`, and supplies bounded deterministic commands. Its passed output and
file hashes are copied into every prompt, and the files become `doNotTouch` for
every worker. Recheck the hashes before accepting a result and before
integration. Missing coverage, a failed command, worker ownership, or drift
fails closed before the controller incurs post-hoc API/schema reconciliation.

Budget controller integration separately from worker execution. The default
soft budget is 900000 ms per ready batch, starting only when the batch has no
active worker and a verified result is ready. It resets for a later dependency
batch. Once exceeded, prohibit ordinary integration and new scope; allow only a
recorded `minimal-contract-repair`, `controller-sequential`, or `replan` action.

Each session is independently terminal: a `failed`, `blocked`, or `needs_input`
result does not erase passed siblings, but blocks affected dependents and final
integration until the controller replans. Stale baselines, changed candidate
fingerprints, out-of-scope paths, missing verification/evidence, and merge
conflicts are not PASS; preserve the other verified results, mark the affected
session for conflict/replan, and return to GPT-6 for diagnosis. This
release permits one running writable Worker per worktree and at most two
allocated implementation Workers until the current batch is integrated. `begin`
derives one bounded Worker plan when approved scope and manifest checks permit
it; the host must execute the returned create/send/wait/read actions. Single and
parallel writable Workers both require isolated worktrees so scope attribution
remains provable, while the frozen shared-interface contract is required only
for a real parallel batch. Quick permits bounded delegation, and orchestration
never auto-commits, pushes, opens PRs,
deploys, or deletes branches. Post-delivery cleanup is separately bounded: only
task-recorded sessions already marked `integrated` may be considered, and the
controller must revalidate exact path, Git common-dir, immutable identity, and
all residual content before ordinary `git worktree remove`. Never use `--force`;
retain and report ignored, unknown, foreign, drifted, or failed candidates.

Scouts explore or verify; GPT-6 owns contracts, scheduling, integration, final
validation, and the verdict.

For dynamic Web verification only, follow `browser-verification.md`: a
browser-only Luna/low executor may perform approved steps without code writes.

## Knowledge, graph, and context

`assess` and assessed `new` already return the top scoped memory and graph hits.
Use separate queries only for a refined need:

```bash
openatdd memory "requirement and paths" --limit 5 --json
openatdd graph-query "requirement and paths" --limit 5 --json
```

The graph is local, source-hashed, rebuildable, and never a source of truth.
Graph failure must not weaken deterministic path-overlap impact analysis.
Project standards live under `.openatdd/knowledge/standards/`; task research
lives under `.openatdd/knowledge/research/`. Standard context may include
standards; Deep may include relevant research. Standard/Deep keep one persisted
`context.json` recovery boundary with separate implementation and verification
views; Quick keeps scoped context in memory.

## Repair and learning

Continue through ordinary errors. Pause only for a conflicting contract,
required behavior decision, unavailable credential/service/permission,
CAPTCHA/hardware, dangerous operation, new authorization, or three recorded
no-progress attempts without a new credible hypothesis.

Record repair attempts with hypothesis, outcome, and progress fingerprint.
When a verified defect exists, open an issue; after repair, resolve it with root
cause, regression protection, invariant, paths, and evidence. Resolution
advances the verification epoch and invalidates the complete prior chain. Rerun
the full approved journey and every affected historical criterion.

```bash
openatdd issue TASK --acceptance AC-03 --status open --symptom "..."
openatdd issue TASK --id ISSUE-001 --status resolved \
  --root-cause "..." --regression "test_name" --invariant "..." \
  --paths "src/path" --evidence evidence.txt
```

Never record formal passed evidence while an issue is open. Never deploy or
send an external notification without existing authorization; generated
notifications remain drafts by default.

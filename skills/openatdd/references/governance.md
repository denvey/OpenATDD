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

- Quick: direct local work; no routine Agent or external research.
- Standard: local discovery and optional independent read-only review when it
  materially reduces risk.
- Deep: parallel local discovery and relevant external research; add an
  independent solution review. Record unavailable research rather than silently
  treating Deep as Standard.

Controller routing is explicit: Quick/Standard use Sol/high and Deep uses
Sol/xhigh. The current controller never auto-upgrades from High to xHigh.
The controller remains workspace-write for direct implementation and final
integration; read-only applies to scouts and independent reviewers.
Discovery and external research use Luna/low, read-only; independent review uses
a fresh Sol/high context for Standard and Sol/xhigh for Deep. Give every role a
bounded context and record a host runtime attestation matching model, reasoning
effort, sandbox, `forkTurns:none`, and leaf capability. Parent runtime overrides
remain authoritative, so an unverifiable or mismatched runtime fails closed.

After solution approval, a Standard/Deep controller may persist a structured
Git-private execution plan. Route bounded, unambiguous, independently verifiable
tasks to Luna/max and complex/cross-module or ambiguous implementation to
Terra/high. Workers are leaves: `canSpawnAgents=false`; they cannot change
acceptance, solution, authorization, scheduling, or final verdicts. Their PASS
must match actual in-scope changed paths, every planned verification command,
fresh evidence, and the current candidate fingerprint. Lifecycle `completed`
is never a PASS. This release permits one running writable worker per worktree;
parallel writes require isolated worktrees so scope attribution remains provable.
Scouts explore or verify; Sol owns contracts, scheduling,
integration, final validation, and the verdict.

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

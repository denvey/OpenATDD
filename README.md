# OpenATDD

**描述需求；Quick 直接交付，Standard / Deep 确认验收与方案。**

OpenATDD 1.0 is a standalone, acceptance-first AI delivery framework. A person
describes the desired feature in normal language, answers only material product
or authorization decisions, and receives an autonomously implemented,
evidence-backed delivered result. Quick uses compact autonomously
approved contracts; Standard and Deep retain concise acceptance and solution
confirmations.

```text
requirement
  -> repository discovery -> Quick / Standard / Deep
  -> only unresolved human decisions (recommendation + 2-3 choices)
  -> Quick: compact acceptance + solution -> autonomous approval
  -> Standard / Deep: acceptance approval -> solution approval
  -> focused implementation -> non-formal rehearsal -> repair
  -> source freeze -> checks + approved journey + history once
  -> DELIVERED -> no reply unless an objection reopens repair
```

Standard and Deep have two routine confirmations. Quick preserves the same
contract order and hashes but does not pause when no blocking human decision
exists. A formal solution cannot be approved before acceptance, product code
cannot be changed before both persisted gates pass, and approved contracts
cannot be edited silently. Delivery adds no third approval. Deterministic and
API results show evidence without requiring repeated testing; only blocking
manual observations add UAT steps, and a person replies only when objecting.

All human-facing content follows the current conversation language. There is no
`--language` option, language configuration, or language-selection question.

## Quick start

OpenATDD requires Node.js 20 or newer and has no runtime dependencies.

```bash
npm link
openatdd init
openatdd new order-export --requirement "Let finance export filtered orders"
```

To make the bundled Skills discoverable in Codex, copy or symlink
[`skills/openatdd`](skills/openatdd) and
[`skills/openatdd-code-review`](skills/openatdd-code-review) into your Codex
skills directory, then reload Codex. Keeping symlinks is convenient while
developing this repository.

For one live development installation shared by every project:

```bash
ln -sfn "$(pwd)/skills/openatdd" "$HOME/.codex/skills/openatdd"
ln -sfn "$(pwd)/skills/openatdd-code-review" "$HOME/.codex/skills/openatdd-code-review"
npm link
```

After source updates, the symlink and linked `openatdd` command use them
immediately; start a new Codex task or reload Codex to refresh Skill
instructions. A copied installation must be copied again to update it.

Invoke the bundled Codex Skill with:

```text
$openatdd Let finance export filtered orders
$openatdd-code-review Review the current changes against the approved task
```

The agent writes exactly one task file:
`.openatdd/requirements/order-export.md`. Its top is the delivery and human
acceptance entry; approved acceptance, solution, and trace details follow below.
Machine state, evidence, previews, indexes, and recovery data live under the
Git-private path resolved by `git rev-parse --path-format=absolute --git-path openatdd`,
so they never enter the worktree or a commit. Quick validates and approves its
compact contracts without routine pauses; Standard and Deep pause at both gates.
`$openatdd-code-review` is the read-only companion: it reviews a diff against
approved OpenATDD contracts and repository rules without creating a task or
modifying code. If the user later requests fixes, verified findings return to
the normal OpenATDD issue or delivery flow.

Useful commands:

```bash
openatdd status order-export
openatdd resume order-export
openatdd assess order-export --scope cross-module --project-pattern established \
  --reversibility reversible --uncertainty medium
openatdd advance order-export --summary "方案简洁，并沿用现有项目边界"
openatdd approve-acceptance order-export
openatdd draft-solution order-export
openatdd review-solution order-export --status passed --reviewer main \
  --check all --summary "方案简洁，并沿用现有项目边界"
openatdd approve-solution order-export --begin
openatdd finalize order-export --fast
openatdd finalize order-export --dry-run
openatdd finalize order-export
```

A Quick task merges its five autonomous approval commands — acceptance
approval, solution draft, main review, solution approval, and implementation
start — into one `advance` invocation; every persisted gate keeps its own
validation, and a blocking or authorization decision still stops the chain.
Standard and Deep keep the two human confirmations and combine the
post-confirmation approval with `approve-solution --begin`. Within one formal
finalization, a narrower check group whose commands are argv-identical to an
already executed group reuses that evidence; the broad group always executes.

These workflow commands are normally executed by the agent, not by a person.
They use `.openatdd/finalization.json`; the successful formal command prepares
the report and enters `DELIVERED`. Granular `preflight`, `check`, `record`,
`batch`, `handoff`, and `ready` commands remain available for debugging and
projects that have not adopted the manifest yet.

## Adaptive depth without process ceremony

OpenATDD records one deterministic lane from repository-derived facts:

- **Quick** — local, established, and low uncertainty. Small bugs normally stay
  here, even when they touch sensitive code or require guarded operations. Work
  stays direct and local with compact autonomous approvals; no routine
  confirmation, subagent, or external research wait.
- **Standard** — ordinary cross-module or moderately uncertain work. Local
  discovery is normal and an independent review is optional.
- **Deep** — system-wide, novel cross-cutting, or highly uncertain problem
  solving. New product work is more likely to qualify, but a complex system bug
  can also be Deep and a small feature can remain Quick or Standard. Relevant
  external research accompanies local discovery; independent read-only review
  is used when it reduces risk.

Depth measures complexity only. Reversibility plus migration, authentication,
authorization, payment, privacy, security, external-service, production,
deletion, compatibility, and external-side-effect signals remain explicit
safety and verification overlays, but never change the lane by themselves.
Dangerous or externally mutating operations still require explicit authorization
regardless of lane, and that requirement is enforced rather than advisory: the
`deletion`, `production`, `irreversible`, `shared-data-migration`, and
`external-side-effect` overlays make `approve-solution` fail until every active
overlay is covered by a resolved `authorization` decision that names it in
`coversOverlays`. A flat `authorization_overlays` key in `.openatdd/config.yaml`
extends this set with other risk overlays — for example `payment` — and can
never remove a built-in one. Reopening acceptance returns every resolved
authorization decision to pending because the authorized behavior may have
changed. The other overlays only strengthen preflight, redaction, rollback,
compatibility, and evidence requirements.

Routing changes internal effort and routine interaction. Quick uses compact
autonomous approvals; Standard and Deep use the two human confirmations.
OpenATDD investigates discoverable facts first. Every remaining human-owned
decision is stored with an owner, two or three choices, consequences, a
grounded recommendation, and the final selection. Blocking decisions stop the
first approval; routine Agent-owned implementation choices do not become user
questions.

The marked solution section in `.openatdd/requirements/<task>.md` is the
canonical solution source. Section-level hashes protect the acceptance and
solution contracts independently, so delivery-summary updates do not invalidate
either approval.

## Rebuildable knowledge and scoped context

The Git-private `knowledge/graph.json` is a rebuildable semantic index derived from
tasks, decisions, acceptance, solutions, paths, incidents, invariants,
the current project truth, standards, research, checks, evidence, and
environment observations. Every node and edge has source provenance. Missing
or stale indexes rebuild automatically; the graph is never a source of truth
and requires no graph database service.

`.openatdd/knowledge/project.md` is the one compact source for facts that remain
true now: product rules, architecture boundaries, and key technical decisions.
`openatdd init` creates its three-section template without overwriting maintained
content. Quick, Standard, and Deep implementation and verification contexts all
receive one source-hashed `ProjectTruth` reference automatically. Task state and
normal task-start output keep only path/digest/size metadata, not a second copy
of the body. Changing the file makes derived graph and context data stale so it
is rebuilt on the next use.

Keep this file short and delete obsolete statements. Tasks, decisions,
incidents, and Git preserve history; the file describes the current system. The
agent may propose an update in an approved solution, but must not silently infer
or rewrite project facts.

Reusable project standards live under `.openatdd/knowledge/standards/`; scoped
investigation notes live under `.openatdd/knowledge/research/`. Standard context
can receive relevant standards, while Deep context can additionally receive
relevant research. Both remain ordinary source-hashed files rather than new
services or approval steps.

Graph relationships extend conservative path-overlap analysis when OpenATDD
marks historical acceptance for reverification. If the graph is unavailable,
the deterministic path fallback continues to work.

Each task can produce one `context.json` with distinct implementation and
verification references. Quick context stays in memory; Standard and Deep
context persists by default for recovery and scoped verification. Source
digests cause stale context to rebuild instead of silently drifting.

Every subagent task label resolves to one `default` read-only scout profile:
`gpt-5.6-luna/low` with no inherited conversation history. Independent searches
run in parallel; the main Agent waits for their compressed evidence, then owns
all decisions, code changes, and final validation. Dispatch records preserve the
selected profile, isolation settings, available token counts, and duration.

Known-target Quick changes use a compact default work budget: one location
step, one targeted batch read, one smallest-complete patch, affected checks,
and one diff review. This is a warning boundary rather than a correctness cap;
semantic search, graph tracing, additional reads, or broader checks require a
concrete risk or failed hypothesis. Known-failing repository-wide checks are
reported as baseline limitations instead of being rerun ceremonially.

Useful diagnostic commands include `graph-rebuild`, `graph-query`,
`graph-impact`, `context-build`, and `context-show`. They are internal tools,
not extra human gates.

## Agent evaluation

The versioned Agent runner supports deterministic fixtures, arbitrary argv-only
adapters, and a bundled Codex real-model adapter. It runs hidden acceptance
checks, repeated trials, and an optional bare-agent baseline. Reports cover human
turns, unnecessary questions, research
misroutes, missed decisions, over-engineering, contract violations, first-pass
acceptance, repeatability, tokens, and time. A model's self-report is never
treated as test evidence.

```bash
npm run eval
npm run eval:agent
openatdd agent-eval --scenario evals/agent/scenarios/simplicity.v1.json \
  --adapter codex --model gpt-5.6-terra --reasoning-effort medium \
  --bare-agent --runs 2 \
  --report evals/reports/openatdd-real.json
openatdd agent-eval --verify-report evals/reports/openatdd-real.json \
  --min-runs 2 --require-baseline
```

The first command actually invokes the model. The verifier is deterministic and
is what finalization should run, so rehearsal and formal finalization do not pay
for or vary a second model evaluation. Mock-only reports cannot claim a real
model pass. Primary, bare baseline, and ablation runs share the explicitly
selected model and reasoning effort, which are persisted in report metadata.

### End-to-end delivery comparison

Schema-v2 delivery scenarios evaluate actual implementation instead of a
planning response. Each scenario copies a small project into three isolated
workspaces and runs `bare`, `thin-atdd`, and `full-openatdd` with the same model,
reasoning effort, provider configuration, timeout, and repetition count. The
Agent may inspect, edit, and test the project. Hidden argv-only acceptance runs
after the Agent exits and is the only source of `functionalPass`; a completion
claim cannot turn a failing workspace green.

```bash
for difficulty in simple medium complex; do
  openatdd agent-eval \
    --scenario "evals/agent/scenarios/delivery-${difficulty}.v2.json" \
    --adapter codex --model gpt-5.6-terra --reasoning-effort medium \
    --runs 2 --report "evals/reports/delivery-${difficulty}.json"
done

openatdd agent-eval \
  --summarize-report evals/reports/delivery-simple.json \
  --summarize-report evals/reports/delivery-medium.json \
  --summarize-report evals/reports/delivery-complex.json \
  --summary-json evals/reports/delivery-summary.json \
  --summary-markdown evals/reports/delivery-summary.md
```

The bare prompt contains only the ordinary implementation request and a normal
handoff request. `thin-atdd` loads the bounded `thin-atdd.v2.md` contract.
`full-openatdd` loads `full-openatdd-runtime.v2.md` in two clean host-gated
phases: contracts only, then implementation/verification. The host rejects any
phase-one product edit and owns deterministic state, evidence, and finalization;
the implementation model does not embed the complete Skill or search other
Skills. Reports include functional pass,
self-verification, false-ready, technical-plan and handoff rates, changed files,
normalized command invocations, duration, and cached/uncached token totals.
Two-run differences are descriptive only.

Compare an optimized summary with a frozen baseline and mechanically enforce
the accepted quality/cost thresholds:

```bash
openatdd agent-eval \
  --compare-baseline evals/reports/delivery-summary.json \
  --compare-candidate evals/reports/delivery-summary-optimized.json \
  --comparison-json evals/reports/delivery-optimization.json \
  --comparison-markdown evals/reports/delivery-optimization.md \
  --enforce-optimization
```

## On-demand strategy retrospective

Normal delivery never narrates framework strategy. After a task, explicitly
request a deterministic retrospective only when it is useful:

```bash
openatdd retrospect order-export
openatdd retrospect order-export \
  --eval-report evals/reports/openatdd-real.json
openatdd retrospect order-export --json
```

The command writes `retrospective.md` and `retrospective.json` inside the task
directory. It shows the selected lane and reasons, OpenATDD capabilities and
their design inspirations, what was actually observed, what was not used,
evidence links, total and autonomous phase timing, Agent critical path,
integration tail, preflight failures, resolved issues, outcome metrics, and
evidence-bounded optimization suggestions.
It reads existing artifacts only: it does not invoke a model, change delivery
state, add a confirmation, or run an evaluation.

When an explicit real-model experiment is warranted, capability ablations can
be added to the normal primary and bare groups:

```bash
openatdd agent-eval --scenario evals/agent/scenarios/simplicity.v1.json \
  --adapter codex --bare-agent \
  --ablate progressive-solution-review --runs 2 \
  --report evals/reports/simplicity-ablation.json
```

Ablation runs cost model tokens and therefore never happen automatically.
Reports preserve total, cached, uncached, and output tokens when the adapter
provides them. Design inspiration never means that an external framework was
executed or installed.

## Portable fast finalization

Each project stores its execution contract in
`.openatdd/finalization.json`. It defines argv-only real entry-point smokes,
optional reusable in-epoch preflight assertion commands,
ordered focused/module/broad check groups, one to five cohesive approved-journey
batches under the compatible `uat` manifest key,
acceptance-to-evidence mappings, deferred historical replay, and non-blocking
repetition budgets. Copy the example from
[`fast-finalization.md`](skills/openatdd/references/fast-finalization.md) and
replace only project-specific commands, surfaces, paths, and mappings.

Automatic acceptance must be exercised by real argv-only journey commands.
`runner: "internal"` is only a manual handoff for `ASSISTED` or `MANUAL`
criteria; it records `manual` and can never satisfy an `AUTO` criterion.

Manifest resolution prefers an explicit path, then the task's Git-private
`tasks/<task>/finalization.manifest.json`, then the reusable project
manifest. The frozen `finalization.json` snapshot that a successful finalization
writes into the task is evidence, never an input for a later run.
`validate-finalization` checks schema and current acceptance mappings without
executing commands or writing a preview. Deterministic component/project
harnesses with no live dependencies may explicitly use
`preflight.scope: "project"` plus a reason; default environment preflight
remains strict and project scope cannot consume declared command environment
variables. Not requiring credentials never disables leak protection: any
declared local values that do exist are still redacted from and scanned out of
every persisted artifact.

`openatdd finalize <task> --fast` performs static validation, the rehearsal, and
one formal finalization in a single invocation. Every stage keeps its own
diagnostics; the split ladder below stays available when the intermediate output
is what you need. Commands run independently by default. A command may opt into
same-epoch evidence reuse with `"deterministic": true` only when repeated
execution cannot observe time, randomness, external state, or side effects;
matching argv alone is insufficient. A Quick task also skips a frozen check
group narrower than `broad` that maps to no acceptance or history evidence, and
records every skipped group in its metrics.

The default order is:

```text
focused implementation and repair
→ openatdd finalize <task> --fast   (or the explicit ladder below)
→ openatdd validate-finalization <task>
→ openatdd finalize <task> --dry-run
→ repair all rehearsal findings
→ freeze the complete source fingerprint
→ openatdd finalize <task>
→ delivery report; perform only listed manual UAT and object only on failure
```

The rehearsal invokes real configured entry points and validates preflight,
coverage, report rendering, links, redaction, and source stability. It does not
record formal passes, advance the verification epoch, reverify history, prepare
a notification, or enter READY. The formal run performs one broad group, one
complete command-backed approved journey when automatic criteria exist, and one
affected-history pass for the final fingerprint,
then commits all projected state atomically. Repeating a completed unchanged
fingerprint is an idempotent cache hit.

This preserves lane-appropriate gates. Quick remains autonomous; Standard and
Deep keep exactly two human gates. Finalization enters `DELIVERED` without a
third confirmation. The person may inspect the evidence and any residual
manual UAT; no reply is needed unless an objection reopens repair.

## Project environment and local test account

`openatdd init` creates a reusable profile at
`.openatdd/environments/local.yaml`, an evidence-backed observation index, and
an empty `.env.openatdd.example`. It also adds `.env.openatdd.local` to
`.gitignore`.

The YAML profile contains only non-secret facts and credential variable names:

```yaml
environment: local
workspace: .
entry_url: "http://127.0.0.1:3000"
role: tester
organization: qa-org
credential_variables: "OPENATDD_TEST_USERNAME, OPENATDD_TEST_PASSWORD"
```

Copy the generated example and fill the real local-only values:

```bash
cp .env.openatdd.example .env.openatdd.local
```

The restricted loader rejects shell expansion and command substitution.
Runtime values are never copied into cards, state, memory, reports, evidence,
or logs, and readiness scans persisted artifacts for leaks.

When a profile declares a login, organization, integration, fixture, or known
workaround, pass a sanitized assertion JSON file to `openatdd preflight
<task> --assertions <file>`. Every applicable passed assertion must reference a
fresh evidence file; account values never belong in the assertion file.

Verified non-secret changes are accumulated instead of rediscovered:

```bash
openatdd observe-env local --key entry_url \
  --value "http://127.0.0.1:3000" \
  --source "local startup output" --evidence <safe-evidence-file>
openatdd memory "local entry URL" --json
```

If a value changes, the former observation remains in stale history with its
source and verification time.

## Faster delivery verification and detailed handoff

OpenATDD optimizes the order without weakening the final journey:

1. focused checks while code changes;
2. module checks after repairs close;
3. one non-formal rehearsal against real entry points;
4. one broad check after the complete source fingerprint freezes;
5. one complete approved journey and affected-history pass in the current
   clean verification epoch.

For browser work, `openatdd plan-uat <task>` groups setup/login, the primary
journey, and final readback/evidence into a few cohesive batches. The agent
reuses the session and captures DOM/screenshots at checkpoints or failure.
Round-trip and discovery budgets produce warnings, not quality failures.

Browser execution is cost-routed. Stable command-backed journeys use
`--execution-mode deterministic` and no model. Dynamic pages use
`--execution-mode browser-low`: a clean-context `gpt-5.6-luna`/low executor
receives only approved steps and assertions, reuses one session, and escalates
failure or uncertainty to the main model. Subjective visual conclusions use
`--execution-mode human` and remain as manual UAT steps in the delivery report. A lower model
reduces price, while batching, scoped DOM facts, and checkpoint-only screenshots
reduce Token.

Successful formal finalization updates the top of the single requirement file
in Reviewer decision order: status and merge recommendation, conclusion, human
acceptance entry, Reviewer focus, actual changes, and acceptance summary.
Automatic results require no repetition. Blocking `ASSISTED` and `MANUAL`
criteria render environment, entry point, identity, credential variable names,
prerequisites, estimated time, ordered actions, expected results, judgment, and
failure feedback. Record a successful human result with
`openatdd record <task> --acceptance AC-01 --status manual --human-confirmed`.

Run the project checks with:

```bash
npm test
npm run eval
npm run check
```

## What OpenATDD protects

- Acceptance is defined from the user's journey before technical design.
- Every solution row traces back to an acceptance criterion.
- Contract hashes detect silent edits after approval.
- Passed items require fresh, local evidence.
- Repairing a defect invalidates earlier results and forces a full-chain rerun.
- Shared impact paths mark related historical acceptance results as affected.
- Semantic relationships expand impact analysis while preserving path fallback.
- Quick uses compact autonomous approvals; Standard and Deep keep two human gates.
- Human decisions always carry grounded recommendations and 2-3 choices.
- A current-hash simplicity review protects the one-source progressive solution.
- Implementation and verification receive distinct source-hashed context.
- Repeated repairs preserve hypotheses and progress fingerprints for recovery.
- Root causes, regression protection, and invariants become searchable memory.
- Current product rules, architecture boundaries, and technical decisions enter every task as one compact project-truth reference.
- Evidence-backed environment facts are reused and stale values are preserved.
- Local credentials stay in an ignored restricted dotenv file and are redacted.
- Preflight blocks wrong workspaces, services, roles, organizations, and fixtures.
- Browser work is planned in cohesive batches with non-blocking time budgets.
- A non-formal rehearsal catches delivery and link defects before source freeze.
- The final fingerprint includes tracked, modified, and untracked deliverables.
- Final checks, approved-journey evidence, acceptance mapping, and historical replay commit atomically.
- Repetition metrics enforce one broad group, one complete journey, and one
  affected-history pass per successful fingerprint.
- Formal evidence belongs to the latest clean verification epoch.
- Delivery handoff contains evidence, residual manual steps, and prepared links.
- External notification defaults to a generated draft until explicitly authorized.

OpenATDD does not integrate with or require OpenSpec, Spec Kit, Superpowers,
Trellis, or another workflow framework. It does not mandate TDD, Gherkin,
worktrees, multi-agent execution, a particular architecture, a model provider,
or production deployment. It governs outcomes and evidence while leaving
implementation choices to the project and the agent.

## Project layout

```text
skills/openatdd/              delivery Skill and standalone CLI
skills/openatdd-code-review/  read-only Code Review Skill
bin/openatdd.mjs              npm command shim
tests/                        deterministic workflow and gate tests
evals/                        deterministic and real-agent scenarios, rubrics, reports
.openatdd/                    this repository's own acceptance, memory, and evidence
```

中文定位：**OpenATDD 是面向 AI 编程的开源验收驱动交付框架。描述需求；Quick 直接交付，Standard / Deep 确认验收与方案，其余交给 AI。**

Controller selection is deterministic rather than automatic escalation:
Quick/Standard use `gpt-5.6-sol/high`; Deep uses `gpt-5.6-sol/xhigh`. A task
started as High does not silently become xHigh. The Codex host must explicitly
apply the routed controller and prove the actual runtime; a mismatch blocks the
run instead of silently falling back.
The controller remains workspace-write because Quick and any unbounded or
ambiguous implementation stay with Sol; scouts and reviewers remain read-only.

Agent roles are selected separately from the controller. Luna/low handles
read-only discovery and research. Standard/Deep independent review uses a fresh
Sol/high or Sol/xhigh context. Only an approved structured execution plan can
delegate writes: bounded implementation uses Luna/max; complex or ambiguous
implementation uses Terra/high. Workers are leaf Agents (`canSpawnAgents=false`)
and cannot change acceptance, solution, authorization, scheduling, or the final
verdict. PASS requires actual in-scope changed paths, all planned verification,
fresh evidence, and the current candidate fingerprint.
Only one writable worker may run in a worktree at a time; parallel writes require
isolated worktrees so actual path ownership remains provable.

```bash
openatdd plan-execution TASK --input execution-plan.json
openatdd agent-dispatch TASK --id AGENT-001 --role bounded-implementation \
  --subtask-id ST-001 --status running --attestation runtime.json
openatdd agent-result TASK --input execution-result.json
```

The JSON inputs are caller-side transient files. Accepted plans and results are
stored in Git-private task state, preserving the one visible requirement file.
This routing is measurable but not a claimed cost or quality win until a real
project evaluation demonstrates it.

# OpenATDD

**描述需求；Quick 直接交付，Standard / Deep 确认验收与方案。**

OpenATDD 1.0 is a standalone, acceptance-first AI delivery framework. A person
describes the desired feature in normal language, answers only material product
or authorization decisions, and receives an autonomously implemented,
evidence-backed result ready for human UAT. Quick uses compact autonomously
approved contracts; Standard and Deep retain concise acceptance and solution
confirmations.

```text
requirement
  -> repository discovery -> Quick / Standard / Deep
  -> only unresolved human decisions (recommendation + 2-3 choices)
  -> Quick: compact acceptance + solution -> autonomous approval
  -> Standard / Deep: acceptance approval -> solution approval
  -> focused implementation -> non-formal rehearsal -> repair
  -> source freeze -> checks + batched UAT + history once
  -> detailed steps + links -> human UAT
```

Standard and Deep have two routine confirmations. Quick preserves the same
contract order and hashes but does not pause when no blocking human decision
exists. A formal solution cannot be approved before acceptance, product code
cannot be changed before both persisted gates pass, and approved contracts
cannot be edited silently. Final UAT is a separate human observation, not
another implementation approval.

All human-facing content follows the current conversation language. There is no
`--language` option, language configuration, or language-selection question.

## Quick start

OpenATDD requires Node.js 20 or newer and has no runtime dependencies.

```bash
npm link
openatdd init
openatdd new order-export --requirement "Let finance export filtered orders"
```

To make `$openatdd` discoverable in Codex, copy or symlink
[`skills/openatdd`](skills/openatdd) into your Codex skills directory, then
reload Codex. Keeping a symlink is convenient while developing this repository.

For one live development installation shared by every project:

```bash
ln -sfn "$(pwd)/skills/openatdd" "$HOME/.codex/skills/openatdd"
npm link
```

After source updates, the symlink and linked `openatdd` command use them
immediately; start a new Codex task or reload Codex to refresh Skill
instructions. A copied installation must be copied again to update it.

Invoke the bundled Codex Skill with:

```text
$openatdd Let finance export filtered orders
```

The agent writes `.openatdd/tasks/order-export/acceptance.md` and `solution.md`
in deterministic order. Quick validates and approves the compact cards without
routine pauses; Standard and Deep pause at both gates. The CLI protects state
transitions and contract hashes while the agent performs the implementation.

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
the report and enters `READY_FOR_UAT`. Granular `preflight`, `check`, `record`,
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
`external-side-effect` overlays make `approve-solution` fail until the task
records a resolved `authorization` decision. The other overlays only strengthen
preflight, redaction, rollback, compatibility, and evidence requirements.

Routing changes internal effort and routine interaction. Quick uses compact
autonomous approvals; Standard and Deep use the two human confirmations.
OpenATDD investigates discoverable facts first. Every remaining human-owned
decision is stored with an owner, two or three choices, consequences, a
grounded recommendation, and the final selection. Blocking decisions stop the
first approval; routine Agent-owned implementation choices do not become user
questions.

`solution.md` is the single canonical solution source. Its first screen holds
the recommendation, rationale, main changes, material risks, and exclusions;
concise technical details and acceptance trace remain below for anyone who
wants them. A review bound to the current file hash rejects hidden choices,
summary/detail drift, and needless architecture before approval.

## Rebuildable knowledge and scoped context

`.openatdd/knowledge/graph.json` is a local JSON semantic index derived from
tasks, decisions, acceptance, solutions, paths, incidents, invariants,
standards, research, checks, evidence, and environment observations. Every node
and edge has source provenance. Missing or stale indexes rebuild automatically;
the graph is never a source of truth and requires no graph database service.

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
ordered focused/module/broad check groups, one to five cohesive UAT batches,
acceptance-to-evidence mappings, deferred historical replay, and non-blocking
repetition budgets. Copy the example from
[`fast-finalization.md`](skills/openatdd/references/fast-finalization.md) and
replace only project-specific commands, surfaces, paths, and mappings.

Automatic acceptance must be exercised by real argv-only UAT commands.
`runner: "internal"` is only a manual handoff for `ASSISTED` or `MANUAL`
criteria; it records `manual` and can never satisfy an `AUTO` criterion.

Manifest resolution prefers an explicit path, then
`.openatdd/tasks/<task>/finalization.manifest.json`, then the reusable project
manifest. The frozen `finalization.json` snapshot that a successful finalization
writes into the task is evidence, never an input for a later run.
`validate-finalization` checks schema and current acceptance mappings without
executing commands or writing a preview. Deterministic component/project
harnesses with no live dependencies may explicitly use
`preflight.scope: "project"` plus a reason; default environment preflight
remains strict and project scope cannot consume declared command environment
variables.

`openatdd finalize <task> --fast` performs static validation, the rehearsal, and
one formal finalization in a single invocation. Every stage keeps its own
diagnostics; the split ladder below stays available when the intermediate output
is what you need. Affected-history reverification reuses evidence from the same
frozen epoch when a replay would execute argv-identical commands, so a growing
history no longer multiplies the broad suite. A Quick task also skips a frozen
check group narrower than `broad` that maps to no acceptance or history
evidence, and records every skipped group in its metrics.

The default order is:

```text
focused implementation and repair
→ openatdd finalize <task> --fast   (or the explicit ladder below)
→ openatdd validate-finalization <task>
→ openatdd finalize <task> --dry-run
→ repair all rehearsal findings
→ freeze the complete source fingerprint
→ openatdd finalize <task>
→ human UAT from report.md
```

The rehearsal invokes real configured entry points and validates preflight,
coverage, report rendering, links, redaction, and source stability. It does not
record formal passes, advance the verification epoch, reverify history, prepare
a notification, or enter READY. The formal run performs one broad group, one
complete command-backed UAT journey when automatic criteria exist, and one
affected-history pass for the final fingerprint,
then commits all projected state atomically. Repeating a completed unchanged
fingerprint is an idempotent cache hit.

This preserves lane-appropriate gates. Quick remains autonomous; Standard and
Deep keep exactly two human gates. There is no separate confirmation for
finalization; the person next acts on the prepared human UAT report.

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

## Faster pre-UAT and detailed handoff

OpenATDD optimizes the order without weakening the final journey:

1. focused checks while code changes;
2. module checks after repairs close;
3. one non-formal rehearsal against real entry points;
4. one broad check after the complete source fingerprint freezes;
5. one complete final UAT journey and affected-history pass in the current
   clean verification epoch.

For browser work, `openatdd plan-uat <task>` groups setup/login, the primary
journey, and final readback/evidence into a few cohesive batches. The agent
reuses the session and captures DOM/screenshots at checkpoints or failure.
Round-trip and discovery budgets produce warnings, not quality failures.

Successful formal finalization validates `handoff.json` and generates a report that starts
with the version, environment, role, prerequisites, safe account reference,
entry point, and estimated time. It then provides numbered one-action steps,
expected results, Pass/Fail checkboxes, prepared evidence, human judgments, and
all applicable links. This is still part of the normal two-gate workflow; it
does not add a third confirmation.

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
- Evidence-backed environment facts are reused and stale values are preserved.
- Local credentials stay in an ignored restricted dotenv file and are redacted.
- Preflight blocks wrong workspaces, services, roles, organizations, and fixtures.
- Browser work is planned in cohesive batches with non-blocking time budgets.
- A non-formal rehearsal catches delivery and link defects before source freeze.
- The final fingerprint includes tracked, modified, and untracked deliverables.
- Final checks, UAT, acceptance mapping, and historical replay commit atomically.
- Repetition metrics enforce one broad group, one complete journey, and one
  affected-history pass per successful fingerprint.
- Formal evidence belongs to the latest clean verification epoch.
- Human handoff contains detailed steps, expected results, and prepared links.
- External notification defaults to a generated draft until explicitly authorized.

OpenATDD does not integrate with or require OpenSpec, Spec Kit, Superpowers,
Trellis, or another workflow framework. It does not mandate TDD, Gherkin,
worktrees, multi-agent execution, a particular architecture, a model provider,
or production deployment. It governs outcomes and evidence while leaving
implementation choices to the project and the agent.

## Project layout

```text
skills/openatdd/       installable Codex Skill and standalone CLI
bin/openatdd.mjs       npm command shim
tests/                 deterministic workflow and gate tests
evals/                 deterministic and real-agent scenarios, rubrics, reports
.openatdd/              this repository's own acceptance, memory, and evidence
```

中文定位：**OpenATDD 是面向 AI 编程的开源验收驱动交付框架。描述需求；Quick 直接交付，Standard / Deep 确认验收与方案，其余交给 AI。**

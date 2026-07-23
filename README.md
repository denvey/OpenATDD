# OpenATDD

**An open-source, AI-native ATDD workflow for verified software delivery.**

OpenATDD turns a one-line requirement into two short, human-approved cards and
then lets an AI coding agent implement, pre-verify, repair, and prepare the
evidence-backed handoff.

```text
requirement
  -> acceptance card -> human approval
  -> solution card   -> human approval
  -> implement -> pre-UAT -> repair loop
  -> evidence report -> human UAT
```

The acceptance approval and solution approval are separate gates. A formal
solution cannot be approved before acceptance, product code cannot be changed
before both gates pass, and approved contracts cannot be edited silently.

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

Invoke the bundled Codex Skill with:

```text
$openatdd Let finance export filtered orders
```

The agent writes `.openatdd/tasks/order-export/acceptance.md`, pauses for the
first approval, writes the solution only after that approval, and pauses once
more. The deterministic CLI then protects state transitions and contract
hashes while the agent performs the implementation.

Useful commands:

```bash
openatdd status order-export
openatdd approve-acceptance order-export
openatdd draft-solution order-export
openatdd approve-solution order-export
openatdd begin order-export
openatdd record order-export --acceptance AC-01 --status passed \
  --evidence .openatdd/tasks/order-export/evidence/ac-01.txt
openatdd check order-export --name tests --status passed \
  --command "npm test" \
  --evidence .openatdd/tasks/order-export/evidence/tests.txt
openatdd ready order-export
```

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
- Root causes, regression protection, and invariants become searchable memory.
- External notification defaults to a generated draft until explicitly authorized.

OpenATDD does not mandate TDD, Gherkin, multi-agent execution, a particular
architecture, or production deployment. It governs outcomes and evidence while
leaving implementation choices to the project and the agent.

## Project layout

```text
skills/openatdd/       installable Codex Skill and standalone CLI
bin/openatdd.mjs       npm command shim
tests/                 deterministic workflow and gate tests
evals/                 dev, regression, and holdout agent scenarios
.openatdd/              this repository's own acceptance, memory, and evidence
```

中文定位：**OpenATDD 是面向 AI 编程的开源验收驱动交付工作流。确认验收，确认方案，其余交给 AI。**

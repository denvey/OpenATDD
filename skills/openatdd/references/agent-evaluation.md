# Real Agent evaluation

Read this reference only when acceptance explicitly requires real-model
behavior or cost evidence. Model runs are cost-bearing and never automatic.

Planning scenarios use the bundled adapter, repeated real-model runs, hidden
checks, and a bare baseline:

```bash
openatdd agent-eval --scenario scenario.json --adapter codex \
  --model MODEL --reasoning-effort LEVEL --bare-agent --runs 2 \
  --report report.json
openatdd agent-eval --verify-report report.json --min-runs 2 --require-baseline
```

Delivery schema v2 runs `bare`, `thin-atdd`, and `full-openatdd` in isolated
writable seed workspaces. The Agent exits before hidden argv-only acceptance
runs. Functional pass comes only from those checks; self-description cannot
turn a failing workspace green. All profiles share model, reasoning, provider,
timeout, and repetition count. Reports record profile bytes/hash/version,
functional and false-ready outcomes, self-verification, technical plan, UAT
handoff, normalized command invocations, duration, and cached/uncached/output
Token.

Use optimized profiles from `evals/agent/profiles/`. `thin-atdd.v2.md` is the
compact ATDD core. `full-openatdd-runtime.v2.md` uses two clean host-gated
phases: contracts only, then implementation/verification. The host rejects
phase-one product edits and owns deterministic state/evidence/finalization, so
the implementation model never embeds the complete Skill or searches unrelated
Skills.

Summarize reports, then compare a frozen baseline with the candidate:

```bash
openatdd agent-eval --summarize-report simple.json \
  --summarize-report medium.json --summarize-report complex.json \
  --summary-json summary.json --summary-markdown summary.md
openatdd agent-eval --compare-baseline baseline-summary.json \
  --compare-candidate summary.json --comparison-json optimization.json \
  --comparison-markdown optimization.md --enforce-optimization
```

Mock fixtures remain deterministic regression coverage but never satisfy a
formal real-model claim. Two runs are descriptive only; do not claim causal or
statistical significance.

Generate a deterministic strategy retrospective only when the person asks:

```bash
openatdd retrospect TASK [--eval-report report.json]
```

It distinguishes selected policy, observed execution, unused capabilities,
outcomes, and bounded optimization suggestions without invoking a model or
changing delivery state.

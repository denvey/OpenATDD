---
name: openatdd-code-review
description: Review a local diff, branch, PR, or work in progress read-only against approved OpenATDD acceptance/solution contracts and repository standards. Use when asked to review code, a PR, branch, diff, or current changes. Report evidence-backed findings without modifying code; send explicitly requested fixes to OpenATDD.
---

# OpenATDD code review

Review is a read-only intent, not a fourth Quick/Standard/Deep lane. Prefer
OpenATDD artifacts as the specification; do not create a task merely to review.

## 1. Freeze the review boundary

- Follow repository instructions and preserve unrelated user changes.
- Use the base, task, PR, commit, or paths supplied by the user. For a branch or
  PR, resolve the base and review the merge-base diff. For current work, include
  staged, unstaged, and relevant untracked files.
- Verify that refs resolve and the diff is non-empty. State an invalid or empty
  boundary instead of inventing work.
- Read enough changed code, callers, tests, and invariants to prove behavior.

## 2. Resolve specification and standards

Use the first grounded specification available:

1. the approved acceptance and solution sections in the user-named
   `.openatdd/requirements/<task>.md`;
2. one unambiguous related approved task found from branch, commits, or paths;
3. the PR, issue, design document, or user description.

If several tasks or specs are plausible, ask which one governs. If none exists,
skip spec-conformance conclusions and say so; never fabricate requirements.
Read applicable repository and module rules; they override generic preferences.

## 3. Review two independent axes

**Spec:** find missing or partial requirements, behavior that contradicts the
approved journey, and unrequested scope. Trace each conclusion to the governing
contract text.

**Correctness:** inspect introduced logic, boundary/error behavior, call-path
regressions, authorization and data effects, compatibility, material
performance/concurrency risks, and whether tests observe the changed behavior.
Run only proportionate non-mutating checks. Do not run formatters, fix modes,
dependency installation, generators, or commands likely to rewrite the tree.
Do not report formatting, import order, or lint findings that tooling owns.

Use an independent read-only pass only for large/high-risk changes or on request.

## 4. Enforce the finding bar

Report a finding only when all are present:

- a tight changed or directly affected `file:line` location;
- a reachable trigger or concrete violated contract;
- an observable correctness, security, data, compatibility, or regression
  impact;
- code, call-path, or executed-check evidence;
- a minimal repair or verification direction without implementing it.

Use `P0` for immediate catastrophic impact, `P1` for merge-blocking defects,
`P2` for material non-blocking defects, and `P3` only for concrete low-impact
problems. Do not turn uncertainty into a defect; list it under residual risks.

## 5. Return findings first

Sort by severity, then location. Use this compact shape:

```text
[P1] Short title — path/to/file:line
Trigger: reachable scenario or violated acceptance
Impact: observable failure
Evidence: relevant code, contract, or check
Direction: smallest repair or validation
```

Use host inline-review annotations when available. Do not add praise or a long
walkthrough before findings. If there are no actionable findings, say
`No blocking findings.` Then list residual risks, missing specification, and
checks not run. Never manufacture comments to make a review look useful.

## Fix handoff

Review alone never modifies files, commits, OpenATDD state, PR comments,
approvals, or external systems. If the user explicitly requests fixes, finish
the review first. Resume the related OpenATDD task and use its issue/repair flow;
if none exists, invoke `$openatdd` for a new bug-fix task. Carry each verified
finding forward as an observable regression criterion, not as an assumed fix.

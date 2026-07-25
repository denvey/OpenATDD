# Acceptance card: openatdd-1-0

## Goal

Let a developer describe a feature in normal language, make only the product or risk decisions that truly need a person, confirm concise completion standards and a project-fitting solution, then receive an autonomously implemented and evidence-backed result ready for human UAT.

## Suggested user journey

1. The developer invokes `$openatdd` with a one-line requirement.
2. OpenATDD inspects the repository, relevant project memory, and environment, classifies the task depth, and asks only unresolved human-owned decisions with a recommendation and 2-3 choices.
3. The developer confirms a short completion-standards card.
4. The developer reviews a one-screen solution summary, optionally opens the concise details in the same solution document, and confirms the solution.
5. OpenATDD implements, reviews, repairs, and verifies autonomously, using subagents only when the selected task depth benefits from them.
6. The developer follows the prepared UAT report and marks the observed result Pass or Fail.

## Criteria

### AC-01 [ASSISTED] [BLOCKING] A developer completes the normal two-confirmation journey without process ceremony
- Given: An initialized supported repository and a one-line feature requirement.
- When: The developer starts OpenATDD and responds to any material product, scope, cost, risk, or authorization decisions.
- Then: OpenATDD asks no discoverable or routine process questions, every human decision includes a grounded recommendation and 2-3 choices, the developer confirms only the concise completion standards and solution before implementation, and receives a prepared UAT handoff without additional routine approvals.
- Evidence: Quick, Standard, and Deep agent-scenario transcripts, persisted decision records, the approved cards, and the generated UAT report.

### AC-02 [AUTO] [BLOCKING] Task depth controls investigation and subagents without changing the user contract
- Given: Representative low-risk local, cross-module, and high-risk or novel task scenarios.
- When: OpenATDD classifies each task and prepares its investigation plan.
- Then: It records Quick, Standard, or Deep with reasons; applies deterministic risk escalators; keeps Quick local and direct; and uses external research, clean-context execution, or independent review subagents only when the selected depth calls for them.
- Evidence: Routing fixtures, hard-risk regression tests, structured routing output, and recorded agent-dispatch traces.

### AC-03 [ASSISTED] [BLOCKING] The approved solution is concise, project-fitting, and progressively disclosed from one source
- Given: Approved completion standards with every blocking human decision resolved.
- When: OpenATDD drafts and reviews the solution before presenting it.
- Then: One `solution.md` provides a one-screen recommendation, rationale, changes, material risks, and exclusions followed by optional concise details; every acceptance ID is traced; no material choice is hidden only in the details; unnecessary architecture is rejected; and any post-approval edit invalidates the solution approval.
- Evidence: The rendered solution document, simplicity and consistency review output, contract-validation regressions, and human readability judgment.

### AC-04 [AUTO] [BLOCKING] A rebuildable semantic graph retrieves relevant knowledge and expands impact analysis
- Given: Tasks, decisions, acceptance criteria, solutions, paths, incidents, invariants, standards, research, checks, and evidence with source artifacts.
- When: Those artifacts are approved, resolved, finalized, queried, changed, missing from the index, or rebuilt.
- Then: OpenATDD maintains a local source-hashed node-and-edge index with provenance, marks stale entries, rebuilds missing runtime indexes, returns only relevant relationships, and combines semantic relationships with the existing conservative path fallback to identify historical acceptance that needs reverification.
- Evidence: Graph build/query/impact fixtures, stale and missing-index regressions, provenance assertions, and affected-history integration tests.

### AC-05 [AUTO] [BLOCKING] Implementation, verification, recovery, and learning receive scoped context
- Given: An approved task with routing, decision, graph, memory, and environment facts.
- When: OpenATDD prepares implementation, verification, a fresh-context subagent, or a resumed repair attempt.
- Then: It supplies only relevant source-hashed context, keeps implementation and verification views distinct, persists a compact recovery boundary, records repair hypotheses and progress, promotes resolved defects into incidents and invariants, and does not mandate TDD, worktrees, a particular architecture, or multi-agent execution.
- Evidence: Context-selection fixtures, resume and bounded-repair regressions, subagent context traces, and incident/invariant graph assertions.

### AC-06 [AUTO] [BLOCKING] Existing projects migrate without weakening deterministic delivery
- Given: Existing schema v1/v2 tasks and v0.3 project artifacts, including projects with absent rebuildable indexes.
- When: They are loaded, upgraded, approved, validated, repaired, and finalized under 1.0.
- Then: Existing contracts, evidence, history, environment observations, and readiness semantics remain valid; missing indexes are recreated; product code remains blocked before both approvals; fresh evidence, verification epochs, complete reruns, source freeze, atomic finalization, credential safety, and affected-history reverification continue to be enforced.
- Evidence: State-migration and legacy-project fixtures, complete deterministic tests, dry-run/finalization evidence, and compatibility validation.

### AC-07 [ASSISTED] [BLOCKING] Real-agent evaluation detects interaction and delivery regressions
- Given: Decision, routing, simplicity, recovery, graph, seed-repository, and hidden-acceptance scenarios plus a configured agent adapter.
- When: The 1.0 evaluation command runs against the current Skill and a bare-agent baseline where applicable.
- Then: It reports deterministic and real-agent outcomes, human turns, unnecessary questions, research misroutes, missed human decisions, over-engineering, contract violations, first-pass acceptance, token/time cost, and repeatability without treating model claims as test evidence.
- Evidence: Versioned fixtures and rubrics, runner output, hidden-test results, baseline comparison, and a human review of assisted judgments.

### AC-08 [AUTO] [BLOCKING] OpenATDD 1.0 remains portable, documented, and independently usable
- Given: A clean Node.js 20+ project with no OpenSpec or other workflow framework installed.
- When: A developer installs or copies the package, initializes a project, invokes help and the Skill, runs the documented checks, and packs the release.
- Then: Version 1.0 provides the complete natural-language-to-UAT workflow, CLI semantics are covered by real-process regressions, the Skill validates on supported hosts, existing granular commands remain available for debugging, and the distributable contains all required runtime and documentation files.
- Evidence: Install/copy smoke tests, CLI process tests, Skill validation, package dry-run contents, documentation checks, and `npm run check` output.

## Boundaries

- OpenATDD 1.0 is standalone and does not integrate with or require OpenSpec, Spec Kit, Superpowers, Trellis, or another workflow framework.
- Both completion standards and the implementation solution require explicit human confirmation in 1.0; automatic solution approval is excluded.
- Dashboard UI, production deployment, automatic external notification, role-playing agent teams, and mandatory TDD, Gherkin, worktrees, or multi-agent execution are excluded.
- The semantic graph is a local rebuildable index over canonical OpenATDD artifacts, not a new external graph database or a replacement source of truth.
- Existing uncommitted repository changes are treated as the starting baseline and must not be discarded or overwritten outside the approved 1.0 scope.

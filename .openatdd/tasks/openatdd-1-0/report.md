# UAT 前报告：openatdd-1-0

## 从这里开始

- 版本：1.0.0
- 环境：local
- 角色：n/a
- 安全账户引用：n/a (no login required)
- 入口：打开 report.md。
- 预计时间：12 分钟
- 验证 epoch：10

### 前置条件

- 启动或验证命令: npm run check

## 分步人工验收

请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。

### 第 1 步 — AC-01：A developer completes the normal two-confirmation journey without process ceremony

- 前提：An initialized supported repository and a one-line feature requirement.
- 操作：The developer starts OpenATDD and responds to any material product, scope, cost, risk, or authorization decisions.
- 预期结果：OpenATDD asks no discoverable or routine process questions, every human decision includes a grounded recommendation and 2-3 choices, the developer confirms only the concise completion standards and solution before implementation, and receives a prepared UAT handoff without additional routine approvals.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：此项需要人工判断。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)

### 第 2 步 — AC-02：Task depth controls investigation and subagents without changing the user contract

- 前提：Representative low-risk local, cross-module, and high-risk or novel task scenarios.
- 操作：OpenATDD classifies each task and prepares its investigation plan.
- 预期结果：It records Quick, Standard, or Deep with reasons; applies deterministic risk escalators; keeps Quick local and direct; and uses external research, clean-context execution, or independent review subagents only when the selected depth calls for them.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)

### 第 3 步 — AC-03：The approved solution is concise, project-fitting, and progressively disclosed from one source

- 前提：Approved completion standards with every blocking human decision resolved.
- 操作：OpenATDD drafts and reviews the solution before presenting it.
- 预期结果：One `solution.md` provides a one-screen recommendation, rationale, changes, material risks, and exclusions followed by optional concise details; every acceptance ID is traced; no material choice is hidden only in the details; unnecessary architecture is rejected; and any post-approval edit invalidates the solution approval.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：此项需要人工判断。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)

### 第 4 步 — AC-04：A rebuildable semantic graph retrieves relevant knowledge and expands impact analysis

- 前提：Tasks, decisions, acceptance criteria, solutions, paths, incidents, invariants, standards, research, checks, and evidence with source artifacts.
- 操作：Those artifacts are approved, resolved, finalized, queried, changed, missing from the index, or rebuilt.
- 预期结果：OpenATDD maintains a local source-hashed node-and-edge index with provenance, marks stale entries, rebuilds missing runtime indexes, returns only relevant relationships, and combines semantic relationships with the existing conservative path fallback to identify historical acceptance that needs reverification.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)

### 第 5 步 — AC-05：Implementation, verification, recovery, and learning receive scoped context

- 前提：An approved task with routing, decision, graph, memory, and environment facts.
- 操作：OpenATDD prepares implementation, verification, a fresh-context subagent, or a resumed repair attempt.
- 预期结果：It supplies only relevant source-hashed context, keeps implementation and verification views distinct, persists a compact recovery boundary, records repair hypotheses and progress, promotes resolved defects into incidents and invariants, and does not mandate TDD, worktrees, a particular architecture, or multi-agent execution.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)

### 第 6 步 — AC-06：Existing projects migrate without weakening deterministic delivery

- 前提：Existing schema v1/v2 tasks and v0.3 project artifacts, including projects with absent rebuildable indexes.
- 操作：They are loaded, upgraded, approved, validated, repaired, and finalized under 1.0.
- 预期结果：Existing contracts, evidence, history, environment observations, and readiness semantics remain valid; missing indexes are recreated; product code remains blocked before both approvals; fresh evidence, verification epochs, complete reruns, source freeze, atomic finalization, credential safety, and affected-history reverification continue to be enforced.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)

### 第 7 步 — AC-07：Real-agent evaluation detects interaction and delivery regressions

- 前提：Decision, routing, simplicity, recovery, graph, seed-repository, and hidden-acceptance scenarios plus a configured agent adapter.
- 操作：The 1.0 evaluation command runs against the current Skill and a bare-agent baseline where applicable.
- 预期结果：It reports deterministic and real-agent outcomes, human turns, unnecessary questions, research misroutes, missed human decisions, over-engineering, contract violations, first-pass acceptance, token/time cost, and repeatability without treating model claims as test evidence.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：此项需要人工判断。
- 已准备证据：[check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-10/check-module-evaluations-module-eval-suite.md), [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md), [batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md), [batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md), [batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md)

### 第 8 步 — AC-08：OpenATDD 1.0 remains portable, documented, and independently usable

- 前提：A clean Node.js 20+ project with no OpenSpec or other workflow framework installed.
- 操作：A developer installs or copies the package, initializes a project, invokes help and the Skill, runs the documented checks, and packs the release.
- 预期结果：Version 1.0 provides the complete natural-language-to-UAT workflow, CLI semantics are covered by real-process regressions, the Skill validates on supported hosts, existing granular commands remain available for debugging, and the distributable contains all required runtime and documentation files.
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md), [batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md), [batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md), [batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md)

## 相关链接

- [详细 UAT 报告](report.md)
- [已批准的验收卡](acceptance.md)
- [已批准的方案卡](solution.md)
- [问题与修复日志](issues.md)
- [local 环境档案](../../environments/local.yaml)
- [Finalization 清单](../../finalization.json)
- [项目文档](../../../README.md)
- [AC-01 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-01 证据: batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)
- [AC-02 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-02 证据: batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)
- [AC-03 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-03 证据: batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md)
- [AC-04 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-04 证据: batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md)
- [AC-04 证据: batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)
- [AC-05 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-05 证据: batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md)
- [AC-05 证据: batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)
- [AC-06 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-06 证据: batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md)
- [AC-06 证据: batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md)
- [AC-07 证据: check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-10/check-module-evaluations-module-eval-suite.md)
- [AC-07 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-07 证据: batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md)
- [AC-07 证据: batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md)
- [AC-07 证据: batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md)
- [AC-07 证据: batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md)
- [AC-08 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md)
- [AC-08 证据: batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md)
- [AC-08 证据: batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md)
- [AC-08 证据: batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md)
- [AC-08 证据: batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md)

## 交付证据摘要

- 需求：Deliver OpenATDD 1.0 as a simple requirement-to-verified-delivery framework with adaptive task depth, recommended human decisions, concise acceptance and solution confirmation, conditional subagents, a local semantic knowledge graph, scoped context, deterministic verification, and real-agent evaluation.
- 阶段：READY_FOR_UAT
- 验收批准时间：2026-07-23T23:47:28.700Z
- 方案批准时间：2026-07-24T00:01:57.245Z
- 就绪时间：2026-07-24T02:51:30.265Z

### 验收结果

| 验收 | 类型 | 阻塞 | 状态 | 证据 |
|---|---|---:|---|---|
| AC-01 | ASSISTED | 是 | manual | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md) |
| AC-02 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md) |
| AC-03 | ASSISTED | 是 | manual | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-journey-routing-solution-uat-journey-routing-solution.md](evidence/finalize/epoch-10/batch-journey-routing-solution-uat-journey-routing-solution.md) |
| AC-04 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md) |
| AC-05 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md) |
| AC-06 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-knowledge-context-uat-knowledge-context.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-knowledge-context.md), [batch-knowledge-context-uat-compatibility-recovery.md](evidence/finalize/epoch-10/batch-knowledge-context-uat-compatibility-recovery.md) |
| AC-07 | ASSISTED | 是 | manual | [check-module-evaluations-module-eval-suite.md](evidence/finalize/epoch-10/check-module-evaluations-module-eval-suite.md), [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md), [batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md), [batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md), [batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md) |
| AC-08 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-10/check-broad-project-broad-project-check.md), [batch-agent-portability-uat-real-agent-report.md](evidence/finalize/epoch-10/batch-agent-portability-uat-real-agent-report.md), [batch-agent-portability-uat-agent-evaluation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-agent-evaluation.md), [batch-agent-portability-uat-package-dry-run.md](evidence/finalize/epoch-10/batch-agent-portability-uat-package-dry-run.md), [batch-agent-portability-uat-official-skill-validation.md](evidence/finalize/epoch-10/batch-agent-portability-uat-official-skill-validation.md) |

### 项目检查

- OpenATDD 1.0 intelligence and knowledge regressions [focused]：**passed** — `node --test tests/intelligence.test.mjs tests/intelligence-integration.test.mjs tests/knowledge.test.mjs tests/agent-eval.test.mjs` — 939 ms
- OpenATDD deterministic and Agent evaluation corpus [module]：**passed** — `npm run eval` — 1012 ms
- Complete OpenATDD 1.0 project checks [broad]：**passed** — `npm run check` — 2271 ms

### 修复

- ISSUE-001：Human-facing templates, contract aliases, and report rendering were hard-coded to English instead of deriving display language from the current requirement and solution artifacts.（INC-2026-006）
- ISSUE-002：Finalization collapsed prepared evidence and required human judgment into one passed status for every criterion classification.（INC-2026-007）
- ISSUE-003：The solution contract checked named sections but not their progressive order, and a free-form review lacked complete checks and independent reviewer provenance.（INC-2026-008）
- ISSUE-004：Resume, repair, and Agent dispatch recorded control state but did not invoke one shared scoped-context loader for the appropriate surface.（INC-2026-009）
- ISSUE-005：Graph discovery omitted standards and research directories, while invariants were keyed by incident identity instead of canonical content.（INC-2026-010）
- ISSUE-006：Formal acceptance relied on mock evaluation tests because no bundled real-model adapter, persisted-report verifier, or pass-rate guard existed.（INC-2026-011）

### 受影响的历史验收

- detailed-uat-handoff：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- fast-portable-finalization：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-mvp：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09

### 人工判断

- AC-01 [ASSISTED]：A developer completes the normal two-confirmation journey without process ceremony
- AC-03 [ASSISTED]：The approved solution is concise, project-fitting, and progressively disclosed from one source
- AC-07 [ASSISTED]：Real-agent evaluation detects interaction and delivery regressions

### 性能观察

- 环境预检：1 ms
- 预计浏览器往返：3
- ACCEPTANCE_DRAFT：26296643 ms
- ACCEPTANCE_APPROVED：31 ms
- SOLUTION_DRAFT：868514 ms
- CONTRACT_APPROVED：41 ms
- IMPLEMENTING：2091865 ms
- PRE_UAT：19408 ms
- READY_FOR_UAT：137410 ms
- REPAIRING：401483 ms
- PRE_UAT：45847 ms
- READY_FOR_UAT：5697103 ms
- REPAIRING：1674087 ms
- PRE_UAT：105776 ms

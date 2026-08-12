# INC-2026-013: Simple 冒烟中 full-openatdd 仍由主模型反复修复合同和 finalization：38 次命令、1,557,774 输入 Token、451,937 ms，未达到宿主确定性执行目标。

- Area: skills/openatdd/scripts/codex-agent-adapter.mjs
- Source task: optimize-atdd-runtime-cost
- Source issue: ISSUE-001
- Created: 2026-07-28T22:30:24.215Z

## Root cause

full delivery 仍要求主模型创建、调试和反复执行合同与 finalization 状态机，确定性流程错误进入模型上下文并造成级联重试。

## Invariant

INV-2026-013: 确定性的门禁、状态、证据和 finalization 由宿主执行；实现模型只接收冻结合同，不操作工作流状态机。

## Regression protection

- host_gated_full_delivery_rejects_phase_one_product_edits_and_runs_two_clean_contexts

## Impact paths

- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `evals/agent/profiles/full-openatdd-runtime.v2.md`
- `tests/agent-eval.test.mjs`

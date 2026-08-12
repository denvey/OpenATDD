# Issues: optimize-atdd-runtime-cost

## ISSUE-001 [resolved] AC-03

- Symptom: Simple 冒烟中 full-openatdd 仍由主模型反复修复合同和 finalization：38 次命令、1,557,774 输入 Token、451,937 ms，未达到宿主确定性执行目标。
- Root cause: full delivery 仍要求主模型创建、调试和反复执行合同与 finalization 状态机，确定性流程错误进入模型上下文并造成级联重试。
- Regression protection: host_gated_full_delivery_rejects_phase_one_product_edits_and_runs_two_clean_contexts
- Invariant: 确定性的门禁、状态、证据和 finalization 由宿主执行；实现模型只接收冻结合同，不操作工作流状态机。
- Memory: INC-2026-013

## ISSUE-002 [resolved] AC-05

- Symptom: Formal complex delivery evaluation full-openatdd run 2 passed generated tests but failed hidden acceptance because eraseAt equaled deletionRequestedAt instead of exactly 30 days later; false-ready rate 50%.
- Root cause: The complex evaluation hid required JavaScript Date input, ISO persistence, restore/purge audit events, idempotent return value, and null-redaction semantics that were absent from the visible story; generated tests could pass a different valid interpretation and create false readiness.
- Regression protection: delivery_complex_public_contract_matches_hidden_observables_and_full_passes_two_runs
- Invariant: Every hidden acceptance assertion must trace to an explicit visible requirement; dynamic API input types, exact stored/returned values, state-transition side effects, idempotent results, and time boundaries are part of the acceptance contract.
- Memory: INC-2026-014


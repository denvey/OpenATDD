# 方案卡：acceptance-outcome-routing

<!-- openatdd:recommendation -->
## 推荐方案

把成功 finalization 的统一终态改为 `DELIVERED`，不新增 `ACCEPTED`、`AUTO_ACCEPTED` 或第三个批准门。现有 `AUTO / ASSISTED / MANUAL` 只决定交付报告的内容：自动标准展示证据，真正需要人观察的标准附带 UAT 步骤；用户没有异议时任务保持完成，有异议时在同一任务中进入修复流程。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 项目已经用 `AUTO / ASSISTED / MANUAL` 表达验证责任，继续复用即可，不需要接口关键词识别器或多套终态。
- 只有需求卡和方案卡两次开发前批准；交付后不再要求“批准验收”。
- `DELIVERED` 只声明 AI 已完成并提交结果，不伪称人做过显式签收；旧 `READY_FOR_UAT` 状态仍可读取和恢复。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 增加统一的 `DELIVERED` 终态；finalize、ready、历史重验、任务计时和 CLI 输出使用该状态。
- 报告按验收分类渲染：API 等确定性任务只展示实际结果与证据；阻塞 `MANUAL` 标准才附带人工 UAT 步骤。
- 已交付任务收到异议时复用现有 issue/repair/verification epoch 流程，不创建新卡；无异议不产生额外状态转换。
- 更新 Skill、README、验收模式参考、UI 提示与回归测试，明确“默认交付，异议重开”。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 风险：旧代码把 `READY_FOR_UAT` 当作唯一终态，遗漏一处会造成命令或计时异常。缓解：集中提供兼容终态判断，并用全仓精确搜索和旧状态 fixture 覆盖。
- 风险：`DELIVERED` 被误读为所有人工标准已经验证。缓解：报告必须明确区分 AI 已验证、待人观察和剩余风险，终态名称不使用 `ACCEPTED`。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不改变 Quick、Standard、Deep 路由和两次方案前确认。
- 不降低自动证据、preflight、broad check、历史重验或风险授权要求。
- 不新增最终批准命令，不自动部署、不替负责人批准发布，也不迁移或重写已有任务的终态。
<!-- /openatdd:exclusions -->

## 实现细节

- 在 `workflow.mjs` 增加 `DELIVERED` 并集中判断新旧交付终态；新 finalization 一律写入 `DELIVERED`。
- `renderTaskReport()` 和 `renderTaskNotification()` 根据是否存在阻塞 `MANUAL` 标准决定是否展示人工 UAT 区域；自动步骤只作为结果和证据出现。
- 现有 `handoff.json`、`readyAt` 与 CLI `ready` 继续兼容，避免不必要的 schema 和命令迁移；人看到的标签改为交付报告与交付时间。
- issue、record、check、resume 和重复 finalization 接受 `DELIVERED`；交付后记录失败或异议会进入现有 `REPAIRING` 流程。

## 影响路径

- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/strategy.mjs`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/acceptance-patterns.md`
- `skills/openatdd/agents/openai.yaml`
- `README.md`
- `tests/workflow.test.mjs`
- `tests/finalization.test.mjs`
- `tests/strategy.test.mjs`
- `tests/evals.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 成功 finalization 统一进入 `DELIVERED`，纯自动报告只展示证据 | 自动 finalization fixture 断言状态、报告与通知不含批准或重复操作要求 |
| AC-02 | API 与 `ASSISTED` 结果在交付报告中展示证据，无额外批准门 | API/辅助验收 fixture 断言实际结果、证据和默认结束语义 |
| AC-03 | 阻塞 `MANUAL` 只改变报告内容，不改变统一终态 | 阻塞与非阻塞人工标准组合测试断言 UAT 区域和剩余风险说明 |
| AC-04 | `DELIVERED` 上的异议复用 issue/repair 流程 | 交付后失败记录、修复、verification epoch 与重新 finalization 测试 |
| AC-05 | 新旧交付终态兼容，文档与命令统一用词 | 完整测试、旧 `READY_FOR_UAT` fixture、CLI 输出和 npm pack dry-run |

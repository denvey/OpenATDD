# 方案卡：strategy-visibility

<!-- openatdd:recommendation -->
## 推荐方案

新增一个纯按需命令 `openatdd retrospect <task>`。正常执行完全不变；只有手动调用时，才从现有状态、证据和可选评测报告生成简短策略回溯，说明采用了哪些能力、借鉴来源、实际调用、效果和下次优化建议。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 routing、state、evidence 和 Agent eval，不增加运行期埋点服务或外部依赖。
- 报告是确定性派生结果，不依赖模型重新解释，也不会再次运行评测。
- 手动命令本身就是开关，避免新增配置和日常输出。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 增加统一能力目录，记录 OpenATDD 能力名称、借鉴来源和可验证的启用/调用条件。
- 增加 `retrospect` 命令，输出一屏摘要、详细 Markdown 和 `--json` 机器结果。
- 扩展评测报告，记录完整、裸 Agent、能力消融、缓存 Token 和相对差异。
- 基于证据给出保留、减少、关闭或继续观察建议，并链接对应来源。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **错误归因：** 区分“设计借鉴”“策略选择”“实际调用”和“效果相关性”，不宣称单次对照证明因果。
- **旧任务信息不全：** 缺失数据明确显示为不可用，不回填猜测值。
- **消融评测成本：** 回溯不自动调用模型；真实消融只在开发者明确运行评测时发生。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不增加实时策略播报、持久开关、第三次确认、Dashboard 或后台服务。
- 不展示思维链，不运行或依赖被借鉴的外部框架。
- 不让回溯命令修改交付状态、验收结果或正式证据。
<!-- /openatdd:exclusions -->

## 实现细节

1. `strategy.mjs` 保存版本化能力目录，并从任务状态派生 `selected`、`observed`、`not-used`、`unavailable`，每项附来源路径。
2. `openatdd retrospect <task> [--eval-report FILE] [--json]` 只在调用时读取数据；终端显示摘要，同时生成任务内的 `retrospective.md/json`。
3. 效果指标包含确认/决策/Agent/修复数量、验收与检查结果、耗时，以及评测中的输入、缓存输入、输出 Token 和通过率。
4. Agent eval 增加能力 profile 与可选消融组；同一场景共享 rubric 和隐藏检查，报告明确样本量与差异，不自动得出优越性结论。
5. 规则化建议只引用可观察事实；例如质量相同但 Token 更高时建议精简上下文，缺少样本时建议继续观察。

## 影响路径

- `skills/openatdd/scripts/strategy.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/agent-eval.mjs`
- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/SKILL.md`
- `README.md`
- `tests`
- `evals/agent`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 回溯命令与正常工作流完全分离 | 默认输出、交互轮次和兼容性回归 |
| AC-02 | 能力目录、状态派生和中英文回溯渲染 | Quick/Standard/Deep 快照与人工可读性判断 |
| AC-03 | 证据链接、调用记录和 Token/耗时聚合 | 状态、缺失值、缓存 Token 和真实 CLI 测试 |
| AC-04 | 评测 profile、裸 Agent/消融组和规则化建议 | 隐藏检查、差异计算、样本量与无夸大结论测试 |

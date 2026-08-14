# 需求交付：xhigh-luna-routing

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已验收
- 合并建议：不可合并：存在计划外变更

## 交付结论

自动验证已完成，验证 epoch 为 2。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：skills/openatdd/scripts/workflow.mjs
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/scripts/agent-profiles.mjs
- M skills/openatdd/scripts/routing.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/intelligence-integration.test.mjs
- M tests/intelligence.test.mjs

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
| AC-04 | AUTO | passed | Finalization manifest for AC-04 verified this automatic criterion. |
| AC-05 | AUTO | passed | Finalization manifest for AC-05 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：xhigh-luna-routing

## 目标

调整 OpenATDD 模型路由：Standard 和 Deep 使用 Sol xhigh 主控，边界明确与复杂实现统一优先 Luna max，模糊或失败实现回到主 Sol xhigh。

## 建议用户旅程

1. 使用者提交 Quick、Standard 或 Deep 任务后，OpenATDD 根据任务复杂度返回确定性的主控模型档位。
2. Standard/Deep 需要独立评审时，评审使用与主控一致的 Sol xhigh 新上下文；只读探索仍使用 Luna low。
3. 方案批准后，边界明确或复杂但可安全拆分的实现子任务统一交给 Luna max；不能安全拆分、执行失败或仍有重大歧义的工作回到主 Sol xhigh。
4. CLI 状态、运行时证明、测试和文档对上述路由给出一致结果，不再把 Standard/Deep 关键裁决交给 Sol high，也不再默认把复杂实现交给 Terra high。

## 验收标准

### AC-01 [AUTO] [BLOCKING] Standard 和 Deep 使用 Sol xhigh 主控
- 前提：存在已评估的 Standard 和 Deep 任务。
- 操作：分别读取任务路由与持久化状态。
- 结果：两种任务都明确选择 `gpt-5.6-sol/xhigh` 主控；Quick 保持现有 `gpt-5.6-sol/high` 直接执行策略。
- 证据：路由单元测试和 CLI 集成测试。

### AC-02 [AUTO] [BLOCKING] Standard 和 Deep 独立评审统一使用 Sol xhigh
- 前提：Standard 或 Deep 任务发起独立方案评审。
- 操作：解析评审 profile 并校验宿主运行时证明。
- 结果：两种 lane 都要求新的 `gpt-5.6-sol/xhigh` 只读评审上下文；不匹配的模型或推理档位继续失败关闭。
- 证据：profile 单元测试、dispatch 与 attestation 集成测试。

### AC-03 [AUTO] [BLOCKING] 可安全委派的实现统一优先 Luna max
- 前提：已批准方案包含边界明确或复杂但具有精确范围和验证方式的实现子任务。
- 操作：分别解析 `bounded-implementation` 和 `complex-implementation` profile。
- 结果：两种实现角色都使用 `gpt-5.6-luna/max`、工作区可写且为不可派生子 Agent 的叶节点；默认实现路由不再使用 Terra high。
- 证据：profile 单元测试、执行计划和运行时证明集成测试。

### AC-04 [AUTO] [BLOCKING] 模糊或失败实现回到主 Sol xhigh
- 前提：实现无法形成安全的结构化子任务，或 Luna max 子任务返回失败、阻塞或重大歧义。
- 操作：读取路由合同、升级说明和结果处理行为。
- 结果：工作不得静默切换到 Terra；由主 Sol xhigh 重新判断、实现或重新规划，worker 仍不能扩大验收、方案、授权或写入范围。
- 证据：合同测试、失败路径测试和文档断言。

### AC-05 [AUTO] [BLOCKING] 路由变更保持现有执行安全边界
- 前提：仓库已有 schema v3 任务、独立评审预算、结构化执行计划和运行时 attestation。
- 操作：运行完整测试并加载旧任务状态。
- 结果：现有状态兼容、评审预算、scope 校验、证据绑定、Quick 直跑和浏览器 Luna low 路由均保持有效。
- 证据：完整项目测试和既有回归测试。

## 边界

- 本次只调整确定性模型 profile 和相关文档/测试，不新增自动基准榜单抓取、动态按价格选模或新的调度服务。
- Quick 保持 Sol high 直接交付，避免为局部低不确定性任务统一增加 xhigh 成本。
- Luna low 的只读探索和动态浏览器验证保持不变。
- Sol ultra 只保留为人工按需升级方向，不进入默认路由。
- 保留当前工作区中尚未提交的独立评审预算改动，不覆盖或回退用户已有修改。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
<!-- openatdd:recommendation -->
# 方案卡：xhigh-luna-routing

## 推荐方案

保留 Quick/Standard/Deep lane、现有 Agent 角色名和结构化执行合同，只调整权威模型 profile：Quick 继续使用 Sol high；Standard/Deep 主控与独立评审统一使用 Sol xhigh；`bounded-implementation` 与 `complex-implementation` 都使用 Luna max。无法安全委派或 worker 失败/阻塞的工作留给或回到主 Sol xhigh，不引入 Terra 自动兜底。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 直接复用 `CONTROLLER_PROFILES`、`profileForDispatch`、runtime attestation 和现有执行计划 schema，不增加调度器或状态迁移。
- 保留 `complex-implementation` 角色，使已有任务、计划和 CLI 输入继续兼容，只改变其底层权威 profile。
- 主控与独立评审统一到 xhigh，避免 Standard 的最终判断弱于默认实现 worker。
- 两类安全可委派实现统一 Luna max，降低模型分层复杂度；失败关闭仍由现有 BLOCKED/repair 流程承接。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- `routing.mjs`：Standard controller 从 Sol high 改为 Sol xhigh；Quick 不变，Deep 保持 xhigh。
- `agent-profiles.mjs`：Standard 独立评审改为 Sol xhigh；复杂实现 profile 从 Terra high 改为 Luna max，并为实现 worker 明确升级到主 Sol controller 的语义。
- 测试：更新 controller、review、worker 和 runtime attestation 断言；增加 Quick 保持 high、两类实现均为 Luna max、旧任务兼容和失败不切 Terra 的覆盖。
- 文档：同步 README、Skill 和 governance 中的模型路由说明，并删除默认 Terra high 表述。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **Standard 成本和耗时上升**：仅 Standard 主控/评审从 high 升到 xhigh；Quick 保持 high，实际收益继续通过 evaluation 衡量。
- **角色名与模型名不一致造成误解**：保留 `complex-implementation` 是为了兼容，文档明确它现在代表复杂度与合同边界，不代表 Terra 模型。
- **worker 失败后的隐式漂移**：不自动换到其他 worker 模型；现有 BLOCKED/repair 流程把控制权交回主控重新判断。
- **覆盖已有未提交改动**：只对重叠文件做局部增量修改，并在验证前审查完整 diff。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不改变任务 lane 分类规则、风险 overlay、审批次数或执行计划格式。
- 不将 Quick 默认升级到 xhigh。
- 不引入按实时榜单、价格或耗时动态选模。
- 不把 Sol ultra、Terra 或 DeepSeek 加入默认自动升级链。
<!-- /openatdd:exclusions -->

## 实现细节

- Standard controller 使用与 Deep 相同的 `gpt-5.6-sol` / `xhigh`，但保留 Standard 的交互与 Agent policy。
- Standard/Deep `independent-review` 均解析为只读、叶节点、`forkTurns:none` 的 Sol xhigh profile。
- 两种实现 route 均解析为可写、叶节点、`canSpawnAgents:false` 的 Luna max profile；角色名和 route 枚举保持不变。
- worker 的失败或阻塞继续由 execution result 和 repair 状态记录；文档与 profile escalation 指向主 Sol controller，不允许静默 Terra fallback。

## 影响路径

- `skills/openatdd/scripts/routing.mjs`
- `skills/openatdd/scripts/agent-profiles.mjs`
- `tests/intelligence.test.mjs`
- `tests/intelligence-integration.test.mjs`
- `README.md`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | controller profile 映射保持 Quick high、Standard/Deep xhigh | routing 与 CLI 状态测试 |
| AC-02 | Standard/Deep independent-review 统一 Sol xhigh runtime profile | profile、dispatch 与 attestation 测试 |
| AC-03 | 两种 implementation role 统一 Luna max profile | profile 与执行集成测试 |
| AC-04 | worker escalation 指向主控且不包含 Terra 自动回退 | 失败合同与文档断言 |
| AC-05 | 保持 state、评审预算、scope、证据和浏览器路由兼容 | 完整项目回归测试 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。
<!-- /openatdd:details -->

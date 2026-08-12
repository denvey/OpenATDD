# 需求交付：model-tier-routing

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已验收
- 合并建议：可以合并

## 交付结论

自动验证已完成，验证 epoch 为 2。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：无计划外变更
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/scripts/agent-profiles.mjs
- M skills/openatdd/scripts/openatdd.mjs
- M skills/openatdd/scripts/routing.mjs
- M skills/openatdd/scripts/strategy.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/intelligence-integration.test.mjs
- M tests/intelligence.test.mjs
- A skills/openatdd/scripts/execution-contracts.mjs

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
| AC-04 | AUTO | passed | Finalization manifest for AC-04 verified this automatic criterion. |
| AC-05 | AUTO | passed | Finalization manifest for AC-05 verified this automatic criterion. |
| AC-06 | AUTO | passed | Finalization manifest for AC-06 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：model-tier-routing

## 目标

为 OpenATDD 引入分层模型路由：Quick/Standard 使用 Sol High，Deep 使用 Sol xHigh；Luna Low 负责只读探索，Luna Max 负责边界明确的实现，Terra High 负责复杂实现，并以结构化执行计划、范围所有权、结果证据和评测保护交付质量。

## 建议用户旅程

1. 使用者提交需求后，OpenATDD 先按现有事实分类为 Quick、Standard 或 Deep，并返回明确的主控模型档位。
2. 主控完成验收和方案后，把只读探索、独立评审以及可安全委派的实现子任务路由到匹配的模型档位。
3. 可写子任务只有在拥有精确写入范围、依赖、预期结果和验证方式时才能执行；不满足条件的工作由主控直接处理。
4. 子任务返回真实变更、验证和候选指纹；OpenATDD 拒绝越界写入、陈旧证据和仅有生命周期完成声明的结果。
5. 现有 Quick/Standard/Deep 门禁、最终验证、单一可见需求文件和旧任务读取保持兼容，并可通过确定性测试评估路由行为。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 任务深度确定主控 Sol 推理档位
- 前提：存在 Quick、Standard 和 Deep 三种已评估任务。
- 操作：分别读取每种任务的路由结果和状态摘要。
- 结果：Quick/Standard 明确选择 `gpt-5.6-sol/high`，Deep 明确选择 `gpt-5.6-sol/xhigh`；既有风险 overlay 不会单独改变任务深度。
- 证据：路由单元测试、CLI 集成测试和持久化状态断言。

### AC-02 [AUTO] [BLOCKING] Agent 角色按认知负载选择模型档位
- 前提：任务需要探索、外部研究、独立方案评审、有界实现或复杂实现。
- 操作：为每个角色解析推荐 profile。
- 结果：探索/研究使用 Luna Low 只读；Standard/Deep 独立评审分别使用新上下文 Sol High/xHigh 只读；有界实现使用 Luna Max 可写；复杂实现使用 Terra High 可写。
- 证据：profile 单元测试和 dispatch 模型、推理强度、隔离设置集成测试。

### AC-03 [AUTO] [BLOCKING] 可写实现必须先通过结构化执行计划
- 前提：方案已批准并准备拆分实现子任务。
- 操作：保存包含验收追踪、阶段、依赖、写入范围、排除范围、预期结果、验证和首产物的执行计划。
- 结果：计划覆盖已批准验收；同阶段写入范围不重叠；依赖存在且只指向前序阶段；缺字段、未知路由、路径越界或 owner 冲突会被拒绝。
- 证据：执行计划验证单元测试和 CLI 正反向集成测试。

### AC-04 [AUTO] [BLOCKING] 子任务通过必须有最终候选绑定证据
- 前提：一个已计划的实现子任务返回执行结果。
- 操作：记录 PASS 或 BLOCKED、实际变更路径、验证命令结果、证据、候选指纹、失败分类和阻塞原因。
- 结果：PASS 只有在 changed paths 位于声明范围、验证通过且证据绑定当前候选时成立；生命周期 `completed`、越界变更、缺失验证或陈旧候选不能替代 PASS。
- 证据：结果验证单元测试、状态持久化与 CLI 集成测试。

### AC-05 [AUTO] [BLOCKING] 新路由保持现有任务和交付边界兼容
- 前提：仓库包含 schema v3 旧任务、单一可见需求文件约束和现有 UAT/finalization 流程。
- 操作：加载旧状态并运行现有测试、状态摘要、知识图和 finalization 回归。
- 结果：新字段保持可选并使用兼容默认值；不新增公开执行工件；Quick 默认仍直接执行；现有浏览器 Luna Low 路由不变。
- 证据：完整项目测试、旧状态兼容测试和工作树路径断言。

### AC-06 [AUTO] [BLOCKING] 分层路由具备可重复评测入口
- 前提：维护者需要判断分层执行是否优于主 Sol 全部实现。
- 操作：运行确定性路由测试，并使用现有 Agent evaluation 接口选择模型和 reasoning effort。
- 结果：报告可观察 controller/dispatch profile、功能结果、错误就绪、Token 和耗时；文档明确评测通过前不声称成本或质量收益。
- 证据：评测回归、策略报告测试和 README/SKILL 契约检查。

## 边界

- 本次实现声明和验证模型路由及执行契约，不假定所有 Codex 宿主都能实际启动每个自定义档位；宿主无法证明所选模型或权限时必须阻塞，不能静默降级。
- 不新增第二个永久控制器；Sol 始终是唯一的验收、方案、调度和最终裁决角色。
- 不让 Luna Low、Luna Max 或 Terra 创建子 Agent，也不让 worker 扩大验收、方案或授权范围。
- 不新增数据库、队列、服务或公开任务目录；机器计划与结果继续存放在 Git 私有 task state 中。
- Quick 默认保持 Direct；只有已批准方案中边界清晰且可独立验证的实现才允许委派。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# 方案卡：model-tier-routing

<!-- openatdd:recommendation -->
## 推荐方案

在现有 Quick/Standard/Deep 分类上增加确定性的主控 profile，并把 Agent role 从单一 Luna Low scout 扩展为四层能力：Luna Low 只读探索、Sol High/xHigh 隔离评审、Luna Max 有界实现、Terra High 复杂实现。执行计划和结果作为 schema v3 state 的可选 Git 私有结构保存，不增加公开工件或永久控制器；OpenATDD 只声明和验证宿主必须执行的 profile，无法证明模型或权限时阻塞。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 `classifyTask`、`profileForDispatch`、scoped context、state、CLI 和 Agent evaluation，不引入新的运行时依赖。
- 保持复杂度 lane 与风险 overlay 正交，同时让 lane 决定 Sol High/xHigh 主控和独立评审强度。
- 以纯函数验证执行计划和 worker 结果，把可写委派约束在批准方案、精确 scope 和新鲜证据之内。
- 保留 schema v3 和单一可见需求 Markdown；旧任务缺少新字段时使用兼容默认值。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 路由结果新增 controller profile：Quick/Standard 为 Sol High，Deep 为 Sol xHigh。
- profile 按 role/lane 解析 Luna Low、Sol High/xHigh、Luna Max 和 Terra High；Quick 仍禁止常规 Agent。
- 新增执行合同模块，验证 stages、dependencies、acceptanceIds、writeScope、doNotTouch、verification、firstArtifact 以及结构化 PASS/BLOCKED 结果。
- state 新增可选 `execution`，CLI 新增 `plan-execution` 与 `agent-result`，dispatch 绑定 subtask、权威 profile 和运行时证明；无法证明实际模型、effort、sandbox 或叶节点能力时拒绝执行。
- worker 合同固定为叶节点，只能在 subtask 的写入范围内实现和验证，不能创建子 Agent、修改验收/方案/授权或扩大任务合同。
- 更新 Skill、治理说明、README、策略报告和单元/集成测试；真实模型收益仍通过现有 evaluation 接口按需评测。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **宿主不支持或未实际采用指定 Agent 档位**：dispatch/result 必须携带宿主运行时证明并与权威 profile 匹配；无法证明时记录 BLOCKED，不静默替换模型或扩大权限。
- **错误拆分造成并发冲突**：计划验证同阶段 scope overlap、文件 owner 和依赖顺序；不确定任务留给主 Sol。
- **worker 口头宣称完成**：PASS 必须包含范围内 changed paths、通过的 verification、证据和 candidate fingerprint。
- **兼容性退化**：新字段保持可选，loadTask 规范化旧 state；现有 UAT/browser/finalization 语义不变。
- **过早宣称成本收益**：只增加确定性与评测入口，不把外部项目的投影当作本项目实测。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不实现新的调度服务、队列、数据库或常驻多 Agent 团队。
- 不让 worker 修改验收、方案、授权或最终完成判断，也不允许 worker 创建子 Agent。
- 不把所有 Deep 子任务强制交给 Terra；每个子任务仍按自身执行复杂度选择 Luna Max、Terra High 或主 Sol Direct。
- 不运行成本较高的真实模型 A/B；本次交付只提供可重复入口和确定性回归。
<!-- /openatdd:exclusions -->

## 实现细节

- `routing.mjs` 导出 controller profile 并把它写入 routing schema；风险 overlay 不参与 lane/controller 选择。
- `agent-profiles.mjs` 保持 `local-discovery`/`external-research` 为 Luna Low；`independent-review` 按 lane 选择 Sol High/xHigh；新增 `bounded-implementation` 与 `complex-implementation`。所有 profile 明确声明 `leaf`、可写性和 authority 边界。
- 新建 `execution-contracts.mjs`，提供 plan/result、运行时 attestation 和叶节点能力的规范化与验证，不接触文件系统；`workflow.mjs` 负责合同完整性、状态转换、证据捕获和候选指纹比对。
- 执行计划只在 `CONTRACT_APPROVED`/`IMPLEMENTING` 阶段写入 Git 私有 state。结果只能引用已计划任务；同一个 task 的 profile、scope 和 owner 在运行中不可漂移。
- `agent-dispatch` 先验证 subtask、推荐 profile 和宿主 attestation，再创建 scoped context 或持久化记录；实现角色必须证明 `canSpawnAgents=false`，且其结果不能包含合同、验收或授权变更。
- `summarizeState` 与 retrospective 暴露 controller、execution plan/result 摘要，便于 evaluation 对比功能、错误就绪、Token 与耗时。

## 影响路径

- `skills/openatdd/scripts/routing.mjs`
- `skills/openatdd/scripts/agent-profiles.mjs`
- `skills/openatdd/scripts/execution-contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/strategy.mjs`
- `.codex/agents/*.toml`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`
- `README.md`
- `tests/intelligence.test.mjs`
- `tests/intelligence-integration.test.mjs`
- `tests/workflow.test.mjs`
- `tests/strategy.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | routing controller profile 与 state summary | routing/CLI 单元集成测试 |
| AC-02 | lane-aware Agent profiles、运行时 attestation 与叶节点权限边界 | profile/dispatch 正反向测试 |
| AC-03 | execution plan validator 与 `plan-execution` | 合同正反例及 CLI 测试 |
| AC-04 | worker result validator、证据捕获与 `agent-result` | 越界、缺证据、陈旧候选测试 |
| AC-05 | 可选 state 字段、Git 私有持久化与原流程不变 | 旧 state、路径和全量回归 |
| AC-06 | summary/retrospective 与现有 Agent evaluation 参数 | 策略、文档和 eval 回归 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。
<!-- /openatdd:details -->

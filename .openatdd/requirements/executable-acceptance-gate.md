# 需求交付：executable-acceptance-gate

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：交付处理中
- 合并建议：暂不可合并

## 交付结论

需求正在按批准契约实施和验证。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：无计划外变更
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- 尚未记录产品文件变更。

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | 未验证 | 尚未验证 |
| AC-02 | AUTO | 未验证 | 尚未验证 |
| AC-03 | AUTO | 未验证 | 尚未验证 |
| AC-04 | AUTO | 未验证 | 尚未验证 |
| AC-05 | AUTO | 未验证 | 尚未验证 |
| AC-06 | AUTO | 未验证 | 尚未验证 |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# Acceptance card: executable-acceptance-gate

## Goal

Deliver an observable user outcome safely.

## Suggested user journey

1. Start from a representative state.
2. Perform the user action.
3. Observe and verify the result.

## Criteria

### AC-01 [AUTO] [BLOCKING] 实现前必须执行验收测试
- Given: 新任务已有批准的验收与方案
- When: 尝试进入实现
- Then: 缺少可执行验收计划会被拒绝；有效计划先执行并保存真实基线
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

### AC-02 [AUTO] [BLOCKING] 区分功能缺口与执行故障
- Given: 验收测试具有逐条结构化结果
- When: 执行初始基线
- Then: 只接受断言失败或已满足的行为；环境、启动、超时和无效结果阻止进入实现
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

### AC-03 [AUTO] [BLOCKING] 验收测试合同保持冻结
- Given: 已有初始基线及批准合同
- When: 提前改产品代码或随后改测试、命令、环境档案
- Then: 提前实现及合同漂移被拒绝；测试文件不能通过符号链接逃出项目
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

### AC-04 [AUTO] [BLOCKING] 交付通过同一套验收旅程
- Given: 初始测试发现功能缺口
- When: 实现功能并执行正式交付
- Then: 相同测试通过才产生正式通过证据；零退出但结果失败也会被拒绝
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

### AC-05 [AUTO] [BLOCKING] 各入口保持门禁及旧任务兼容
- Given: 存在新旧任务和人工验收项
- When: 恢复、委派、人工就绪或重开方案
- Then: 不可绕过基线；重开作废基线；旧任务继续原流程；主观项明确人工判断
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

### AC-06 [AUTO] [BLOCKING] 命令行报告真实基线
- Given: 提供任务的验收计划
- When: 使用 begin、advance 或 approve-solution --begin
- Then: 使用指定计划执行基线并返回真实结果；文档说明完整使用流程
- Evidence: 可执行 CLI 旅程、门禁行为与全项目回归的真实命令日志

## Boundaries

- Use local deterministic fixtures and do not contact production.
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# Solution card: executable-acceptance-gate

<!-- openatdd:recommendation -->
## Recommendation

扩展现有 begin 与 finalization：新任务先执行 UAT 基线，再进入实现；同一测试合同全绿后交付。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## Why this fits

- It preserves existing boundaries and avoids unrelated infrastructure.
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## Main changes

- Add the approved behavior and its deterministic verification.
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## Risks

- 结构化结果必须覆盖批次验收项并与退出码一致；只允许 assertion 失败作为初始缺口。测试和环境漂移要求重开方案，不静默覆盖基线。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## Deliberate exclusions

- Do not deploy or notify external systems.
<!-- /openatdd:exclusions -->

## Implementation

- 复用已有 argv 执行器、UAT batches、证据及环境预检。新任务 deliveryVersion 4；旧任务保留原流程。保存基线合同、测试文件摘要及真实结果，恢复、委派和就绪均检查；重开合同使基线失效。

## Impact paths

- `skills/openatdd`
- `tests`
- `README.md`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | Implement 实现前必须执行验收测试 | Execute deterministic verification |
| AC-02 | Implement 区分功能缺口与执行故障 | Execute deterministic verification |
| AC-03 | Implement 验收测试合同保持冻结 | Execute deterministic verification |
| AC-04 | Implement 交付通过同一套验收旅程 | Execute deterministic verification |
| AC-05 | Implement 各入口保持门禁及旧任务兼容 | Execute deterministic verification |
| AC-06 | Implement 命令行报告真实基线 | Execute deterministic verification |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 实现与验证记录

- 根因：原流程在批准文字验收后即可进入实现；没有实际执行的实现前验收基线，交付也没有绑定同一测试合同。
- 修复：新任务 deliveryVersion 4；begin、advance 和 approve-solution --begin 复用 UAT 命令、环境预检、退出码检查与证据执行器，保存真实逐条基线。
- 不变量：功能缺口只接受 assertion 失败；已有行为满足可直接记录 already_satisfied；执行故障不能作为测试红灯。基线不产生正式 AUTO 通过。
- 冻结：批准卡摘要、测试字节与权限、命令、预检合同和环境档案；恢复、Worker 派发与结果、集成、就绪和正式交付检查漂移。Worker 的 doNotTouch 包含验收测试。
- 交付：相同测试旅程必须完整通过，证据和验收结果必须处于当前 epoch；命令退出零但结果失败不能交付。重开方案使基线失效。旧 v1–3 任务保留原流程。
- 回归保护：先编写并运行验收门禁测试，初始 12 项失败，表现为缺少门禁与基线、未拒绝合同漂移或错误结果。实现后这 12 项通过；随后扩展至 17 项，包括三种 CLI 入口、篡改证据、符号链接、输出文件与排除测试目录后的完整性。
- 兼容回归：workflow、intelligence-integration、orchestration-workflow、finalization 和 evals 的 102 项检查通过；补充旧 Worker authority 与后补并行指令回归也通过。
- 全项目检查最初 223 项中 222 项通过；剩余评审 Skill 超过 4096 字节上限，已压缩为 3941 字节并通过全部 4 项相关复测。
- 最终验证：npm run check 全部 223 项通过；git diff --check 通过。没有提交或推送。
- 正式状态：不冒报 DELIVERED。部分受影响历史验收卡仍要求固定模型、推理档位或默认 Worker，与当前宿主策略和默认 inline 不一致，已请求是否同步旧卡。当前 task 为 IMPLEMENTING，没有伪造正式验收结果。
<!-- /openatdd:details -->

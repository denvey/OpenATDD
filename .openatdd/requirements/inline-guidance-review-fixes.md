# 需求交付：inline-guidance-review-fixes

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
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：inline-guidance-review-fixes

## 目标

修复模型建议化的旧 Worker 恢复、后补并行指令和浏览器文档冲突，保留权限与隔离边界。

## 建议用户旅程

1. 升级后继续提交已绑定旧路由的 Worker 结果。
2. 为已进入 inline 的批准方案追加并行执行指令。
3. 按浏览器参考说明使用可用宿主模型执行批准步骤。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 已绑定 Worker 的路由不会因加载而漂移
- 前提：旧任务的 Worker 会话已保存包含 routing 的权限指纹。
- 操作：加载任务并沿原合同继续提交结果。
- 结果：保留会话绑定的 routing；真实合同、权限、范围或证据变更仍不能通过。
- 证据：加载和结果提交调用路径审查；行为回归验证待执行。

### AC-02 [AUTO] [BLOCKING] 后补并行指令进入计划阶段
- 前提：已批准任务处于 inline，没有 Worker 计划或活动会话。
- 操作：追加未消费的 parallel 指令并再次 begin。
- 结果：返回 plan-execution；已有 Worker 计划、会话和已消费指令不会被重置。
- 证据：批准与 begin 调用路径审查；行为回归验证待执行。

### AC-03 [AUTO] [BLOCKING] 浏览器说明与宿主模型策略一致
- 前提：宿主提供可用模型和浏览器能力。
- 操作：读取 browser-verification 参考并选择 browser-low。
- 结果：不强制固定模型或命名推理等级，保留只读文件系统、浏览器能力、复用会话和失败升级边界。
- 证据：文档与 verificationExecutionProfile 一致性审查。

## 边界

- 仅修复已确认的三处问题，保留当前分支已有改动。
- 不新增模型、调度抽象或持久化字段，不削弱 Worker 权限和证据校验。
- 未请求新增或运行测试；不以语法检查代替行为验证或正式交付证据。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# 方案卡：inline-guidance-review-fixes

<!-- openatdd:recommendation -->
## 推荐方案

在现有 loadTask 和 begin 路径做局部调整，并同步浏览器参考；复用现有会话权限指纹识别已绑定的路由，不重新计算或覆盖该指纹。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 原权限指纹已覆盖完整 routing，无需新增迁移字段或第二套权限机制。
- 原并行指令、Worker 计划和消费状态足以决定后补指令的下一步。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 有已绑定权限指纹的会话时保留 routing；其余任务继续加载当前默认值。
- 无计划的未消费并行指令优先返回 plan-execution，保留已有委派状态。
- 浏览器参考改为可用宿主模型和推理设置，保留执行边界。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 不得通过刷新权限指纹掩盖真实合同变更；提交结果继续使用原完整指纹检查。
- 并行指令不能重置已有 Worker 计划、活动会话或已消费的调度状态。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不新增或运行测试，不宣称完成行为验证或正式 finalization。
- 不部署、提交或修改外部系统。
<!-- /openatdd:exclusions -->

## 实现细节

- 使用现有 orchestration.sessions 中的 authorityFingerprint 判断路由是否已被绑定。
- 使用现有 directive.consumed、execution.plan 和 planStatus 保留委派状态。

## 影响路径

- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/references/browser-verification.md`
- `skills/openatdd/references/orchestration.md`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | loadTask 保留会话指纹绑定的 routing | 加载、权限指纹、结果提交调用路径审查 |
| AC-02 | begin 优先处理无计划且未消费的并行指令 | 批准、指令消费、begin 路径审查 |
| AC-03 | 同步浏览器参考和恢复说明 | 文档与运行时策略一致性审查 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。

### 修复结果

- 根因：loadTask 更新模型建议时改写了 Worker 权限指纹覆盖的 routing；begin 的 inline 提前返回早于并行指令处理；浏览器参考遗漏模型策略同步。
- 已修改：保留已绑定会话的 routing；无计划且未消费的并行指令回到 not_planned 并返回 plan-execution；浏览器参考统一宿主设置并保留只读与升级边界。
- 不变量：加载不得改变已绑定权限合同；结果提交继续比较完整权限指纹；并行请求不得清除已有 Worker 合同；浏览器模型建议不得替代权限要求。
- 静态检查：workflow.mjs 的 node --check 和 git diff --check 均通过；检查真实 diff 和相关加载、批准、提交路径。
- 验证限制：没有新增或运行测试，没有把静态检查记录为 AUTO 行为验收通过，也没有运行正式 finalization。
- 待复核历史任务：bounded-independent-review、model-tier-routing、multi-session-orchestration、reduce-end-to-end-latency、safe-worktree-cleanup。
<!-- /openatdd:details -->

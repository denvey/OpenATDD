# 需求交付：multi-session-orchestration

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已验收
- 合并建议：不可合并：存在计划外变更

## 交付结论

自动验证已完成，验证 epoch 为 5。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：.openatdd/knowledge/invariants.md, skills/openatdd/references/fast-finalization.md, skills/openatdd/scripts/finalization.mjs, tests/finalization.test.mjs, skills/openatdd/scripts/orchestration-contracts.mjs, tests/orchestration-docs.test.mjs, tests/orchestration-workflow.test.mjs, tests/orchestration.test.mjs
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- M .openatdd/knowledge/invariants.md
- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/fast-finalization.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/references/verification-routing.md
- M skills/openatdd/scripts/execution-contracts.mjs
- M skills/openatdd/scripts/finalization.mjs
- M skills/openatdd/scripts/lib.mjs
- M skills/openatdd/scripts/openatdd.mjs
- M skills/openatdd/scripts/state.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/finalization.test.mjs
- A skills/openatdd/scripts/orchestration-contracts.mjs
- A tests/orchestration-docs.test.mjs
- A tests/orchestration-workflow.test.mjs
- A tests/orchestration.test.mjs

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
| AC-04 | AUTO | passed | Finalization manifest for AC-04 verified this automatic criterion. |
| AC-05 | AUTO | passed | Finalization manifest for AC-05 verified this automatic criterion. |
| AC-06 | AUTO | passed | Finalization manifest for AC-06 verified this automatic criterion. |
| AC-07 | AUTO | passed | Finalization manifest for AC-07 verified this automatic criterion. |
| AC-08 | AUTO | passed | Finalization manifest for AC-08 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：multi-session-orchestration

## 目标

支持一个主控会话创建、调度和汇总多个隔离开发会话，并让它们在独立 worktree 和明确文件所有权下并行完成任务开发。

## 建议用户旅程

1. 使用者在确认方案时，可以直接用自然语言说“并行执行这个方案”或同义表达，不需要填写配置、设置会话数或手工选择子任务。
2. 主控把这句话记录为本次已批准方案的并行执行指令，并自动把可并行实现拆成具有依赖阶段、精确写入范围和验证命令的子任务。
3. 主控为同一阶段的独立子任务请求宿主创建多个隔离 Codex worktree 会话，并记录 thread、worktree、branch、基线和文件所有权。
4. 各开发会话只在自己的 worktree 和授权范围内实现、验证并返回结构化结果；它们不能创建子会话、修改共享合同或直接更新主任务状态。
5. 主控并行等待和读取会话结果，拒绝运行时身份不符、范围越界、基线漂移、缺验证、失败或需要人工输入的结果。
6. 主控按依赖和集成顺序把已验证结果汇入主候选，处理冲突并运行完整验证；只有汇总候选通过验收后任务才交付。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 主控建立可并行的会话执行计划
- 前提：Standard 或 Deep 方案已批准，包含至少两个无依赖或处于同一阶段的实现子任务。
- 操作：主控保存带依赖、route、writeScope、doNotTouch、验证、首产物和会话隔离策略的执行计划。
- 结果：同阶段只有写入范围不重叠的任务可并行；依赖、范围或会话所有权冲突会在创建会话前被拒绝。
- 证据：执行计划和会话合同单元测试、CLI 正反向测试。

### AC-02 [AUTO] [BLOCKING] 方案确认中的自然语言可要求并行执行
- 前提：Standard 或 Deep 方案已经展示，使用者在批准时说“并行执行这个方案”或其他语义明确的同义表达。
- 操作：主控把该表达随方案批准一起持久化为本任务的一次性执行指令，并自动分析方案中的 stage、dependsOn、writeScope、验证和预期结果。
- 结果：主控自动选择所有满足并行安全条件的子任务并安排并行会话，无需使用者填写配置、指定会话数或逐项选择；不满足并行条件的步骤按依赖留在主控或串行执行，并在执行摘要中说明原因。若整个方案无法形成至少两个安全并行子任务，则在实施前明确告知使用者，而不是伪造并行。
- 证据：中文及同义批准表达解析、一次性指令持久化、自动拆分、混合并行/串行和完全不可并行方案测试。

### AC-03 [AUTO] [BLOCKING] 每个开发会话使用独立 worktree
- 前提：主控准备派发两个或更多可写子任务。
- 操作：宿主适配器为每个子任务创建 worktree 会话，并返回 threadId、worktree/branch 身份和来源基线。
- 结果：不同会话具有不同且可验证的 worktree 身份；共享目录、重复 worktree、缺失身份或不可证明隔离时保持现有单写者限制并拒绝并发。
- 证据：mock 宿主适配器集成测试、重复/缺失 worktree 负向测试。

### AC-04 [AUTO] [BLOCKING] 主控可并行调度、等待和汇总会话
- 前提：一组隔离开发会话已创建并绑定计划子任务。
- 操作：主控并行发送子任务合同，等待多个 thread 完成或请求关注，并读取结构化终态结果。
- 结果：状态摘要展示每个会话的 planned/running/passed/failed/blocked/needs_input、耗时与结果；单个会话失败不会丢失其他会话结果，也不会由 worker 判定整个任务完成。
- 证据：创建、消息、等待、结果读取和部分失败的宿主适配器测试。

### AC-05 [AUTO] [BLOCKING] 开发会话保持叶节点和最小权限
- 前提：一个开发会话收到批准子任务。
- 操作：校验其模型、推理档位、worktree、writeScope、父主控和叶节点运行时证明。
- 结果：开发会话不能创建子会话、修改验收/方案/授权/调度/最终裁决，也不能写入其所有权范围外；不匹配时失败关闭。
- 证据：runtime attestation、权限、越界变更与合同突变测试。

### AC-06 [AUTO] [BLOCKING] 子会话结果基于各自基线验证并安全集成
- 前提：一个或多个开发会话返回 changed paths、验证和证据。
- 操作：主控针对会话 worktree 基线验证实际 diff，再按依赖顺序集成到主候选并检查冲突和新指纹。
- 结果：陈旧基线、未提交/不可读取结果、范围越界或集成冲突不能记为 PASS；已通过结果保留，冲突任务回到主控修复或重新派发。
- 证据：worktree-local diff、集成顺序、冲突、陈旧候选和部分成功测试。

### AC-07 [AUTO] [BLOCKING] 共享状态由主控串行持久化
- 前提：多个开发会话可能同时完成或更新进度。
- 操作：子会话通过宿主结果返回或独立结果文件交付，主控按事件/版本串行写入 OpenATDD task state。
- 结果：并发完成不会覆盖其他 session/dispatch/result；重复回调幂等，陈旧版本被拒绝，共享验收和方案文件不会被 worker 修改。
- 证据：交错完成、重复回调、陈旧 revision 和恢复测试。

### AC-08 [AUTO] [BLOCKING] 单会话流程和无适配器宿主保持兼容
- 前提：Quick、旧 schema v3 任务或宿主不提供多会话/worktree API。
- 操作：运行现有 agent-dispatch/result、单 worker、finalization 和旧状态加载流程。
- 结果：Quick 保持直接执行；旧调用继续工作；没有可证明的宿主能力时返回明确 BLOCKED/不支持结果，不静默在共享目录并发写入。
- 证据：全量现有测试、旧状态兼容与 capability-unavailable 测试。

## 边界

- OpenATDD 核心定义宿主无关的 session/worktree 合同；Codex App 适配器映射 create/send/wait/read 能力，但核心不依赖专有 thread 实现。
- 主控是唯一合同、调度、共享 state、集成和最终裁决写者；开发会话是不能继续派生的叶节点。
- 只有 Standard/Deep 的已批准结构化子任务允许多会话；Quick、模糊工作和不能安全拆分的实现留在主控。
- “并行执行这个方案”是当前任务、当前已批准方案的一次性执行指令，不是项目配置，也不会影响后续任务。
- 该指令要求主控最大化方案中安全可行的并行度，但不覆盖依赖、writeScope、worktree、权限、授权或验证门禁；不能并行的步骤仍按依赖串行执行。
- 不允许多个可写会话共享同一 checkout，也不通过关闭现有并发保护来实现伪并行。
- 本次不要求自动推送远端、创建 PR、部署、删除分支或强制清理 worktree；这些外部/破坏性动作保持独立授权。
- 官方 OpenAI 文档搜索确认 Codex 支持并行线程和 worktree 隔离，但页面正文在本次研究中无法抓取；实现验收只依赖本地可重复的宿主适配器合同和测试。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
<!-- openatdd:recommendation -->
# 方案卡：multi-session-orchestration

## 推荐方案

增加一个宿主无关的多会话编排内核，并由 OpenATDD Skill 充当 Codex App 宿主适配器。使用者在方案确认时说“批准方案，并行执行”，主控将其转换为一次性的 `approve-solution --begin --parallel`；之后由核心验证执行计划、会话身份、worktree 隔离、事件 revision、结果范围和集成前置条件，Skill 使用宿主的 create/send/wait/read 能力实际驱动会话。子会话始终是叶节点，只有主控写共享状态、集成代码和判定交付。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 execution plan 的 stage、dependsOn、writeScope、doNotTouch、verification 和 route，不新增第二套任务分解模型。
- 复用现有 Luna max worker profile、runtime attestation、范围校验、证据和 candidate fingerprint 合同。
- OpenATDD 核心只产生和校验宿主动作，不直接依赖 Codex App 私有 API；其他宿主可实现同一 create/send/wait/read 合同。
- 每个会话在独立 worktree 中工作，主控按路径级基线验证并集成，避免简单移除单写者锁造成共享目录竞争。
- 一次性 `--parallel` 指令与当前 solution fingerprint 绑定，既满足自然语言交互，也不会成为全局配置或污染后续任务。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 新增 `orchestration-contracts.mjs`：定义并行指令、宿主 capability、session identity/event/result、revision/idempotency、worktree ownership 与集成前置条件的纯函数校验。
- 扩展 schema v3 task state：在 `execution` 下增加可选 `directive` 和 `orchestration`，记录 controller、capabilities、revision、sessions、events、aggregate 和 integration 状态；旧任务加载时补兼容默认值。
- 扩展 execution plan task 的可选 session/isolation 元数据，保留 schemaVersion 1 和旧输入兼容；只有同阶段、依赖满足且 writeScope 不重叠的任务进入并行批次。
- 扩展 solution approval：CLI 支持 `approve-solution TASK --begin --parallel`，将人类自然语言确认映射成与当前 solution SHA 绑定的一次性并行执行指令。
- 新增 `orchestration-start`、`session-record`、`session-result`、`orchestration-integrate` CLI；status/resume 展示聚合状态和下一步宿主动作。
- Skill 增加 Codex App 适配流程：检查 create/send/wait/read/worktree 能力；创建独立 worktree 任务；批量等待；读取结构化结果；把事件串行提交给 CLI；缺能力时显式 BLOCKED。
- 会话创建时记录主候选与子 worktree 的路径级基线；结果验证只比较该 session 的授权范围。集成前重新确认主候选对应路径未从基线漂移，再以原子文件操作应用新增、修改和删除；任何冲突保留其他已验证结果并回到主控。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **宿主能力或返回字段变化**：核心只接受经过 capability 与 identity 校验的规范化输入；Codex App 映射集中在 Skill，缺失或不可证明时失败关闭。
- **多个会话并发更新 task state 导致丢失**：worker 不得调用状态写命令；所有事件由 controller 串行提交，携带 `eventId` 和 `expectedRevision`，重复事件幂等、陈旧 revision 拒绝。
- **worktree 与主候选发生基线漂移**：创建时保存授权路径基线，结果和集成前分别校验；漂移或冲突不能 PASS，交回主控重规划。
- **自动拆分过度或伪并行**：必须至少两个同阶段、安全隔离的子任务；否则在实施前明确说明无法并行，并保留批准合同不变。
- **部分失败造成全部成果丢失**：session 分别终态化，passed 结果独立保留；failed/blocked/needs_input 只阻止受影响依赖和最终集成。
- **工作区已有未提交修改**：创建会话时记录明确 starting state 和基线；集成只接触被分配路径，不清理、不重置、不覆盖无关修改。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不让 worker 创建或管理子会话，也不让 worker 合并、提交共享状态或决定最终完成。
- 不自动 commit、push、创建 PR、部署、删除分支或清理 worktree。
- 不允许多个可写会话共享同一 checkout；没有独立 worktree 时继续使用现有单写者路径。
- 不对 Quick 任务、未批准方案、范围模糊任务或重叠写入范围强制并行。
- 不新增常驻调度服务、数据库或消息队列；状态继续位于 Git 私有 OpenATDD task storage。
<!-- /openatdd:exclusions -->

## 实现细节

### 一次性并行指令

- 主控理解明确自然语言后调用 `approve-solution TASK --begin --parallel`。
- state 保存 `{ mode: "parallel", source: "human-solution-approval", solutionSha256, requestedAt }`。
- solution 重新打开或 SHA 改变时指令失效，必须由人重新确认；没有 `--parallel` 时保持现有执行方式。

### 编排状态

- `execution.orchestration` 使用 additive schema：`status`、`revision`、`controller`、`capabilities`、`sessions`、`eventIds`、`aggregate`、`integration`。
- session 状态为 `planned → creating → created → running → waiting → passed|failed|blocked|needs_input → integrating → integrated|conflict`。
- 所有 mutation 接受唯一 `eventId` 和 `expectedRevision`。已处理 event 返回幂等结果；revision 不匹配返回稳定错误，不覆盖新状态。

### 宿主动作协议

- `orchestration-start --input capabilities.json --json` 返回规范化 actions，每项包含 subtask、profile、prompt contract、worktree requirement 和 ownership。
- Skill 将 actions 映射为 Codex App `create_thread`、`send_message_to_thread`、`wait_threads`、`read_thread`；其他宿主可使用等价适配器。
- `session-record --input event.json` 只由主控调用，记录 threadId、hostId、worktree path/branch、base identity、状态和耗时。

### 结果与集成

- 会话创建后，主控按 task writeScope 保存主候选和 worktree 的文件基线，并验证它们来自同一 Git common dir、worktree 路径唯一且不等于主 checkout。
- 子会话返回结构化 summary、changedPaths、verification、evidence 和 worktree fingerprint；主控通过 `session-result` 对实际 worktree diff 做范围与基线核验。
- `orchestration-integrate` 只处理已验证 passed session，按 stage/dependsOn 顺序检查主路径仍匹配 base digest，再原子复制/删除授权文件并记录新主候选 fingerprint。冲突 session 标记 `conflict`，其他 session 结果不被抹除。
- 所有 session integrated 后，现有 module/broad/UAT/finalization 针对聚合主候选运行；session PASS 不等于任务 DELIVERED。

## 影响路径

- `skills/openatdd/scripts/orchestration-contracts.mjs`（新增）
- `skills/openatdd/scripts/execution-contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/state.mjs`
- `skills/openatdd/scripts/lib.mjs`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`
- `skills/openatdd/references/verification-routing.md`
- `README.md`
- `tests/orchestration.test.mjs`（新增）
- `tests/intelligence-integration.test.mjs`
- `tests/single-file-storage.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | parallel batch planner 与 session ownership 合同 | 同阶段、依赖、范围和冲突正反例 |
| AC-02 | `approve-solution --begin --parallel` 与 solution-SHA-bound directive | 自然语言 Skill 映射、持久化、失效和不可并行说明测试 |
| AC-03 | capability/session identity/worktree validation | mock host、重复/缺失/共享 worktree 负向测试 |
| AC-04 | orchestration actions、session event 状态机与聚合摘要 | create/send/wait/read、partial failure、needs_input 测试 |
| AC-05 | authoritative worker profile、parent/leaf/ownership attestation | 身份、派生权限、越界和合同突变测试 |
| AC-06 | worktree-local baseline/result validation 与 ordered integration | changed paths、stale base、delete/new file、conflict 和部分集成测试 |
| AC-07 | controller-only event log、eventId/revision/idempotency | 交错、重复、陈旧 event 和恢复测试 |
| AC-08 | additive schema defaults 与原单 worker path | Quick、旧 state、无 capability、全量回归与 linked worktree 测试 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。
<!-- /openatdd:details -->

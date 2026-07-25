# OpenATDD 1.0 实现方案

> 说明：`Implementation`、`Impact paths`、`Acceptance trace`、`Risks`、`Deliberate exclusions` 是当前 CLI 机器校验使用的固定标题；其余内容按用户语言展示。

## 推荐方案

在现有零运行时依赖的 OpenATDD 内核上增量完成 1.0，不重写双确认、合同哈希、证据 epoch、历史重验和 finalization。新增自适应路由与决策、单文件渐进方案、可重建语义图谱、作用域上下文、条件子代理和真实 Agent 评测，最后统一发布 `1.0.0`。

## 为什么适合当前项目

- 复用现有最成熟、最难替代的可信交付能力。
- 对 schema v1/v2 做增量迁移，不破坏已有合同、证据和历史。
- 新复杂度全部留在内部；用户仍只确认完成标准和实现方案。
- 图谱使用本地 JSON 索引，不要求安装或维护独立数据库服务。

## 主要改动

- 增加 Quick / Standard / Deep 路由、推荐式人类决策、硬风险升级、方案简洁性审查和条件子代理记录。
- 一份 `solution.md` 同时提供一屏摘要和简洁技术详情，并继续由单一合同哈希保护。
- 增加可重建的来源哈希语义图谱，以及实现/验证分离的作用域上下文。
- 增加修复假设、进展指纹、恢复边界和事故/不变量关系。
- 增加真实 Agent runner、种子仓库、隐藏验收、裸 Agent 对照、兼容性测试和 1.0 发布验证。

## Implementation

1. **状态与项目迁移**
   - 将任务状态增量升级到 schema v3，增加 `routing`、`decisions`、`reviews`、`agents`、`context` 和 `repair`。
   - 保留所有 v1/v2 字段和延迟持久化行为；缺失的图谱或上下文索引按空索引重建，不阻断旧项目。
   - 1.0 继续强制人工确认完成标准和实现方案，不改变现有验证边界。

2. **自适应路由与决策**
   - 新增 `routing.mjs`：纯规则判断 Quick / Standard / Deep、硬风险升级、调查深度和可用子代理角色。
   - 新增 `decisions.mjs`：记录决策归属、待定/已解决状态、2-3 个选项、推荐依据和最终选择。
   - 增加内部 CLI 命令记录路由、决策、方案审查和 Agent 执行结果；所有持久化参数都用真实进程回归测试保护。
   - Skill 直接跟随当前对话语言，先调查可发现事实，再集中询问互不依赖的人类决策，并始终保持两次例行确认；不增加语言配置、命令或选择步骤。

3. **单一渐进披露方案合同**
   - 扩展 `contracts.mjs`，让 `solution.md` 先呈现推荐、理由、主要变化、重大风险和排除项，再呈现技术详情。
   - 同一文件继续保存影响路径和完整验收追踪。
   - 方案批准前必须记录简洁性与一致性审查；Quick 可由主 Agent 审查，Deep 可用独立审查 Agent。
   - 未解决的阻塞决策、无验收依据的新架构组件或摘要未披露的重大风险都会阻止方案批准。

4. **可重建语义知识图谱**
   - 新增 `graph.mjs`，从任务、决策、验收、方案、代码路径、事故、不变量、规范、调研、检查、证据和环境观察派生节点与关系。
   - 每个节点保存来源路径和摘要；支持 stale 标记、重建、查询和影响分析；图谱不是事实源，也不是交付前置条件。
   - 方案批准时联合使用显式关系、共享不变量和现有路径重叠，扩大历史重验集合。
   - 合同批准、缺陷解决、环境观察和正式 finalization 后刷新相关图谱条目。

5. **作用域上下文、条件子代理、恢复与学习**
   - 新增 `context.mjs`，将相关图谱与记忆引用写入一个带来源摘要的 `context.json`，内部区分 implementation 和 verification。
   - Quick 在内存中生成；Standard / Deep、干净上下文 Agent 或可恢复任务才持久化；来源变化后重新生成。
   - Skill 让 Quick 直接执行，Standard 按需审查，Deep 才并行使用本地调查、外部调研、实现或验证 Agent。
   - 记录修复次数、假设、结果和进展指纹；只有连续无进展且没有新可信假设时才暂停。
   - 已解决缺陷继续形成 incident 与 invariant，并通过图谱进入未来任务的相关检索。

6. **评测、兼容、finalization 与发布**
   - 保留现有确定性 eval，新增适配器式 Agent runner，覆盖路由、决策、简洁性、恢复、图谱、种子仓库、隐藏验收和裸 Agent 对照。
   - 报告人类轮次、多余问题、错误调研、遗漏决策、过度设计、合同违规、首次验收、重复稳定性、token 和耗时；模型自述不能作为通过证据。
   - 更新 finalization manifest 和 UAT 批次覆盖八条 1.0 验收，同时保留 rehearsal、source freeze、clean epoch、原子写入、历史回放、凭据扫描和幂等性。
   - 完整检查和可用真实 Agent 评测通过后，再更新 Skill、元数据、README、package scripts、安装/复制测试和版本号到 `1.0.0`。

## Impact paths

- `skills/openatdd/SKILL.md`
- `skills/openatdd/agents/openai.yaml`
- `skills/openatdd/references`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/contracts.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/manifest.mjs`
- `skills/openatdd/scripts/lib.mjs`
- `skills/openatdd/scripts/routing.mjs`
- `skills/openatdd/scripts/decisions.mjs`
- `skills/openatdd/scripts/graph.mjs`
- `skills/openatdd/scripts/context.mjs`
- `skills/openatdd/scripts/agent-eval.mjs`
- `tests`
- `evals`
- `.openatdd/finalization.json`
- `README.md`
- `package.json`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | 决策优先的 Skill 流程、持久化选择、两次确认和简洁 UAT | 三种任务轨迹、状态门测试、决策 fixtures、人工可读性检查 |
| AC-02 | 纯路由规则、硬风险升级、调查策略和条件 Agent 记录 | 路由 fixtures、CLI 进程测试和 Agent 轨迹 |
| AC-03 | 单文件渐进方案、简洁性/一致性审查和合同哈希 | 解析验证、漂移回归、方案渲染和人工可读性检查 |
| AC-04 | 可重建来源图谱、stale 检测、查询/影响遍历和路径回退 | 图谱 fixtures、缺失/过期索引回归和历史重验集成 |
| AC-05 | 双视图作用域上下文、条件新 Agent、bounded repair 和图谱学习 | 上下文选择、恢复/修复回归、Agent 轨迹和 incident/invariant 断言 |
| AC-06 | schema v3 增量迁移和既有可信交付不变量 | v1/v2 fixtures、完整回归、dry-run、formal finalization 和旧项目 UAT |
| AC-07 | 适配器式真实 Agent runner、种子仓库、隐藏检查和裸 Agent 基线 | 版本化报告、隐藏测试、基线比较、重复运行和人工判断检查 |
| AC-08 | 独立文档、Skill 元数据、CLI、包内容、兼容性和 1.0.0 版本 | 安装/复制/进程测试、Skill 校验、npm pack、文档检查和 `npm run check` |

## Risks

- **范围大且工作区已有改动：** 按依赖顺序做纵向切片，每轮检查实际 diff，保留无关现有修改。
- **图谱或上下文漂移：** 规范 Markdown、state 和 evidence 始终为事实源；保存来源摘要、自动重建，并保留路径重叠和 scoped memory 回退。
- **用户体验膨胀：** 保持一个正常入口和两次短确认，详情仍在同一文件，按需加载引用，并在 Agent eval 中统计人类轮次和多余问题。
- **子代理或评测不稳定：** 子代理只按路由启用，始终保留主 Agent 直接路径；真实模型结果按 assisted evidence 记录。
- **破坏成熟验证：** finalization 只做最小接入，发布前必须通过全部既有确定性、迁移、事务、凭据、历史和打包回归。

## Deliberate exclusions

- 不集成或依赖 OpenSpec、Spec Kit、Superpowers、Trellis 或其他工作流框架。
- 不自动批准完成标准或方案；1.0 保留两次人工确认。
- 不开发 Dashboard、生产部署、自动外部通知、角色扮演 Agent 团队或通用项目管理 UI。
- 不强制 TDD、Gherkin、worktree、子代理、特定架构、模型提供商或托管平台。
- 不用图谱替代规范任务文件，也不削弱现有证据、凭据、历史、rehearsal 和 finalization 保护。

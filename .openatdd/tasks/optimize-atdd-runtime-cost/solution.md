# 方案卡：optimize-atdd-runtime-cost

<!-- openatdd:recommendation -->
## 推荐方案

把 OpenATDD 从“模型反复解释完整工作流”改成“短运行内核 + 按需规则 + CLI 确定性执行”。安装 Skill 的主入口只保留不可妥协规则、分层路由和当前阶段入口；delivery 评测使用独立的 thin v2 与 full-runtime v2 短契约。路由、状态、证据、报告和成本比较继续由 Node.js CLI 完成。Web 预验收采用已批准的混合策略：确定性脚本优先，动态页面交给低模型浏览器，主模型只在失败时接管。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 旧 full 的 628 万输入 Token 不只来自 26,858 字节 Skill，还来自查找 CLI/文档、拆分 validate/dry-run/finalize 和读取生成报告；现有 `advance`、`finalize --fast`、manifest 和报告器已经能确定性完成这些工作。
- thin 的无缓存输入只比 bare 多 18.7%，主要可优化点是无关 Skill 读取和额外 diff/流程命令，而不是删除技术方案。
- 现有 adapter、UAT plan、Agent profile 和 summary 都是纯 Node.js 模块，可增量扩展，不需要服务器、队列、数据库或新的运行时依赖。
- 保留当前 provider、模型和隐藏验收；成本下降来自少读、少回放和少命令，不来自降低质量标准。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 将 `SKILL.md` 收敛为阶段路由内核，详细的治理、浏览器、评测和调试规则移到按需 reference；不可妥协规则与两个人工门禁仍在主入口。
- 新增不超过 1,024 字节的 `thin-atdd.v2.md` 和不超过 4,096 字节的 `full-openatdd-runtime.v2.md`；delivery 不再整份注入 `SKILL.md`，并关闭无关 Skill 搜索。
- full runtime 直接提供当前 CLI 入口，Quick 只走合并合同、一次相关验证和一次 `finalize --fast`；成功路径不搜索安装、不拆分 finalization、不重读生成状态。
- 归一化 Codex JSONL 命令事件，按执行 ID 保留最终状态；新增优化前后 summary 比较和机械成本阈值。
- 为 UAT plan 增加执行路由：稳定 Web 为 deterministic，动态 Web 为 Luna/low 的 browser executor，主观视觉为 human；低模型只接收步骤、断言和当前页面摘要。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **压缩规则遗漏安全约束**：主入口保留全部 non-negotiable 规则；测试联合扫描主入口和 references，要求门禁、风险授权、修复 epoch、凭据和人工 UAT 契约仍存在。
- **full-runtime 退化成 thin**：full v2 仍要求正式验收/方案工件、风险 overlay、影响历史和 manifest finalization，但这些由短指令调用现有 CLI，而不是让模型复述实现细节。
- **低模型浏览器误操作**：只允许已批准的本地/测试环境和有界步骤，不做产品决策、不修改代码、不访问生产；失败或断言不确定立即返回主模型。
- **时间指标受模型波动影响**：使用三个难度、每组两次的聚合结果，并同时检查 Token、命令数和质量；阈值失败时优化实现，不降低模型、重复次数或验收条件。
- **旧报告被覆盖**：优化运行写入新报告和新 summary，原始 baseline 保持只读并校验哈希。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不删除技术方案检查点、自验收、人工 UAT、风险授权或 Standard / Deep 的两次确认。
- 不让低模型负责架构、产品决策、代码实现、危险操作或主观视觉结论。
- 不为降低成本切换 provider、降低主模型推理强度、减少正式重复次数或暴露隐藏验收。
- 不把两次运行的差异表述为统计显著或普遍因果结论。
<!-- /openatdd:exclusions -->

## 实现细节

- `codex-agent-adapter.mjs` 分离 planning Skill 与 delivery runtime profile；最小 delivery 配置额外关闭 `skill_search`，并通过安全环境变量提供当前 `openatdd.mjs` 入口。profile 元数据记录版本、来源、字节数和 SHA-256。
- thin v2 限定一次目标读取、一个最多 8 行的 `TECHNICAL_PLAN.md`、最小实现、相关检查 + 用户旅程和简短交接；明确禁止读取其他 Skill 或框架文档。
- full-runtime v2 只说明当前 task 的 `new/advance/finalize --fast` 快速路径、风险触发条件和工件要求；详细 reference 仅在 Deep、浏览器、环境配置、失败诊断或显式评测时读取。
- JSONL 命令归一化优先使用 `item.id` 合并 start/completed 事件；没有 ID 时只合并相邻的同命令生命周期，保留失败状态和真实独立重跑。
- 新的成本比较器读取冻结 baseline summary 和 candidate summary，输出 thin/full 的时间、总/缓存/非缓存/输出 Token、命令数和质量差异，并对 AC-06 阈值返回非零退出码。
- UAT 执行路由是纯函数和计划元数据：`deterministic` 无模型；`browser-low` 固定 `gpt-5.6-luna`、low、`forkTurns:none`、browser-only；`human` 只生成判断步骤。最终人工 UAT 不被 AI 替代。
- 确定性回归通过后，重新运行 simple/medium/complex 三组两次真实模型评测，输出 `delivery-*-optimized.json`、`delivery-summary-optimized.*` 和 `delivery-optimization.*`。

## 影响路径

- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/`
- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `skills/openatdd/scripts/agent-eval.mjs`
- `skills/openatdd/scripts/agent-profiles.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `evals/agent/profiles/`
- `evals/reports/`
- `tests/agent-eval.test.mjs`
- `tests/intelligence.test.mjs`
- `tests/delivery-v2.test.mjs`
- `README.md`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 主 Skill 内核保留五段职责链和 Quick/Standard/Deep 门禁 | 工作流、提示和 UAT 交接快照 |
| AC-02 | thin v2、full-runtime v2 与按需 references | profile 字节/SHA、禁止整份 Skill 注入测试 |
| AC-03 | 精确 CLI 入口、合并 `advance`、`finalize --fast` 和禁止无关读取 | 命令轨迹 fixture 与优化真实报告 |
| AC-04 | JSONL 生命周期合并和成本比较器 | 成对事件、独立重跑、失败事件及 summary 回归 |
| AC-05 | 隐藏验收和完整项目检查保持不变 | 三难度真实报告与 `npm run check` |
| AC-06 | baseline/candidate 机械阈值验证 | 优化 summary：thin -15%/-10%，full -80%/-50% 且 ≤2× bare |
| AC-07 | deterministic/browser-low/human 三路 UAT executor | 路由、模型/profile、会话和截图预算测试 |
| AC-08 | planning/delivery/provider/finalization 向后兼容 | 旧 schema、CLI 进程、provider 与凭据扫描 |

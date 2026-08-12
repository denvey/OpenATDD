# UAT 前报告：optimize-atdd-runtime-cost

## 从这里开始

- 版本：1.0.0
- 环境：local
- 角色：n/a
- 安全账户引用：n/a (no login required)
- 入口：打开 report.preview.md。
- 预计时间：8 分钟
- 验证 epoch：3

### 前置条件

- 启动或验证命令: npm run check

## 分步人工验收

请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。

### 第 1 步 — AC-01：优化后仍保留完整的人机职责链

- 前提：用户只给出一句功能目标和使用方式。
- 操作：分别执行 Quick、Standard 和 Deep 的优化工作流。
- 预期结果：三条路径都保持“AI 推导验收 → 技术方案检查点 → AI 实现 → AI 自验收 → 人工 UAT”；Quick 不增加例行暂停，Standard / Deep 仍只有验收与方案两次人工确认。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 2 步 — AC-02：模型只接收当前阶段需要的有界规则

- 前提：现有 thin profile 为 1,285 字节，完整 Skill 为 26,858 字节且在 delivery 运行中整份注入。
- 操作：构建优化后的 thin 与 full delivery 提示，并检查安装后的 Skill 入口。
- 预期结果：thin v2 不超过 1,024 字节；full delivery 的常驻运行契约不超过 4,096 字节且不内嵌完整 Skill；主 Skill 只保留关键规则和阶段路由，详细规则按需读取；bare 提示保持无 OpenATDD 线索。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 3 步 — AC-03：常见任务不再执行无关流程与重复验证

- 前提：旧 full 简单场景会搜索 CLI/文档、拆分 validate/dry-run/finalize 并读取生成报告；thin 会额外加载无关开发 Skill。
- 操作：在已配置的本地项目中执行优化 profile。
- 预期结果：thin/full 都禁止无关 Skill、外部调研和重复项目发现；Quick full 使用合并合同推进与 `finalize --fast`，不拆分成功路径、不重复读取生成状态；只有被实际风险或失败触发的阶段才加载额外规则。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 4 步 — AC-04：成本报告准确区分真实命令和重复事件

- 前提：Codex JSONL 会为同一命令发送开始与完成事件，旧报告把二者都计入命令数组。
- 操作：采集 delivery JSONL、Token 和耗时并生成优化对照报告。
- 预期结果：同一命令执行只记录一次最终状态；每次运行继续记录总输入、缓存输入、非缓存输入、输出 Token、耗时、profile 字节数、功能结果和交接指标，并可机械比较优化前后差异。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 5 步 — AC-05：精简上下文不削弱交付质量

- 前提：简单、中等、复杂三个隐藏验收场景及旧基线报告保持冻结。
- 操作：用优化后的 thin/full profile 运行相同场景并在 Agent 退出后执行隐藏检查。
- 预期结果：优化组功能通过率、自验收率、技术方案率和 UAT 交接率均为 100%，错误就绪率为 0；项目现有 134 项检查继续通过。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 6 步 — AC-06：真实模型评测证明成本按预期下降

- 前提：旧报告保存相同模型、推理强度、provider 配置和每组两次运行的成本。
- 操作：在配置不降级的前提下，对三个难度运行优化后的 profile 并与旧报告聚合比较。
- 预期结果：thin 聚合总输入 Token 至少降低 15%、平均耗时至少降低 10%；full 聚合总输入 Token 至少降低 80%、平均耗时至少降低 50%，并将总输入控制在同轮裸 Agent 的 2 倍以内；同时报告缓存与非缓存输入、输出 Token、命令数及小样本限制，不声称统计因果。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 7 步 — AC-07：Web 预验收优先使用零模型或低模型执行

- 前提：浏览器页面快照、逐步推理和重复截图会扩大上下文；降低模型等级只能降低价格，不能自动减少输入 Token。
- 操作：为稳定 Web 旅程、动态 Web 旅程和主观视觉验收分别路由执行方式。
- 预期结果：稳定旅程优先运行确定性 Playwright/项目脚本，不再调用模型；动态旅程由主模型生成有界批次和断言，再交给低模型浏览器执行器在一个复用会话中操作，只返回结构化结果并仅在检查点或失败时截图；主模型只在失败诊断时接管；主观视觉结论仍由人验收。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 8 步 — AC-08：优化保持兼容与 provider 安全

- 前提：项目已有 planning v1、delivery v2、mock/command/Codex adapter、用户自定义 provider 和正式 finalization。
- 操作：运行旧 schema 回归、CLI 进程测试、provider 配置测试与凭据扫描。
- 预期结果：现有场景和 CLI 继续可用；所有对照共享同一 provider 与配置模式；优化不输出凭据、不访问生产系统，也不自动发送通知。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

## 相关链接

- [详细 UAT 报告](report.preview.md)
- [已批准的验收卡](acceptance.md)
- [已批准的方案卡](solution.md)
- [问题与修复日志](issues.md)
- [local 环境档案](../../environments/local.yaml)
- [Finalization 清单](finalization.manifest.json)
- [项目文档](../../../README.md)

## 交付证据摘要

- 需求：在保留验收优先、技术方案检查点、AI 自验收和人工 UAT 的前提下，减少精简 ATDD 与完整 OpenATDD 的模型上下文、命令往返、耗时和 Token，并用可重复评测证明优化没有削弱交付质量。
- 阶段：PRE_UAT
- 验收批准时间：2026-07-28T21:42:20.627Z
- 方案批准时间：2026-07-28T21:57:28.757Z
- 就绪时间：尚未就绪

### 验收结果

| 验收 | 类型 | 阻塞 | 状态 | 证据 |
|---|---|---:|---|---|
| AC-01 | AUTO | 是 | 未验证 | - |
| AC-02 | AUTO | 是 | 未验证 | - |
| AC-03 | AUTO | 是 | affected | - |
| AC-04 | AUTO | 是 | 未验证 | - |
| AC-05 | AUTO | 是 | affected | - |
| AC-06 | AUTO | 是 | 未验证 | - |
| AC-07 | AUTO | 是 | 未验证 | - |
| AC-08 | AUTO | 是 | 未验证 | - |

### 项目检查

没有记录项目检查。

### 修复

- ISSUE-001：full delivery 仍要求主模型创建、调试和反复执行合同与 finalization 状态机，确定性流程错误进入模型上下文并造成级联重试。（INC-2026-013）
- ISSUE-002：The complex evaluation hid required JavaScript Date input, ISO persistence, restore/purge audit events, idempotent return value, and null-redaction semantics that were absent from the visible story; generated tests could pass a different valid interpretation and create false readiness.（INC-2026-014）

### 受影响的历史验收

- detailed-uat-handoff：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- end-to-end-agent-eval：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- eval-user-config：AC-01, AC-02, AC-03
- fast-portable-finalization：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-1-0：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-mvp：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09
- optimize-quick-delivery：AC-01, AC-02, AC-03, AC-04
- strategy-visibility：AC-01, AC-02, AC-03, AC-04

### 人工判断

没有剩余的人工验收项。

### 性能观察

- 环境预检：0 ms
- 预计浏览器往返：1
- ACCEPTANCE_DRAFT：662427 ms
- ACCEPTANCE_APPROVED：144 ms
- SOLUTION_DRAFT：907986 ms
- CONTRACT_APPROVED：73 ms
- IMPLEMENTING：1330363 ms
- REPAIRING：645022 ms
- PRE_UAT：1812470 ms
- REPAIRING：1767258 ms

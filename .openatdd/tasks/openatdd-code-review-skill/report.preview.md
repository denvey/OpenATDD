# UAT 前报告：openatdd-code-review-skill

## 从这里开始

- 版本：1.0.0
- 环境：local
- 角色：n/a
- 安全账户引用：n/a (no login required)
- 入口：打开 report.preview.md。
- 预计时间：6 分钟
- 验证 epoch：1

### 前置条件

- 启动或验证命令: npm run check

## 分步人工验收

请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。

### 第 1 步 — AC-01：审查优先对照已批准的 OpenATDD 合同

- 前提：目标改动关联一个已有验收卡和方案卡的 OpenATDD task。
- 操作：使用新 Skill 审查指定 diff。
- 预期结果：审查明确区分“是否符合验收/方案”和“代码本身是否正确”，能够指出漏做、错误实现和未要求的范围扩张；仓库规范优先于通用偏好。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 2 步 — AC-02：无 OpenATDD task 时仍可安全回退

- 前提：目标改动没有可定位的 OpenATDD task。
- 操作：使用 PR/issue/用户描述和仓库规范执行 Review。
- 预期结果：AI 不伪造需求；能找到规格就继续，规格缺失时只审查可证明的正确性与风险，并明确“需求符合度未验证”。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 3 步 — AC-03：Findings 有统一严重级别和证据门槛

- 前提：diff 中包含可复现或可由调用路径证明的问题，同时包含只属于格式偏好的噪声。
- 操作：执行 Review 并生成结果。
- 预期结果：每条 finding 包含 P0～P3、标题、紧凑 `file:line`、触发条件、实际影响、代码/测试证据和最小修复或验证方向；按严重性排序，不报告 formatter/linter 可处理的问题，不把猜测写成确定缺陷。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 4 步 — AC-04：Review 全程只读且结果诚实

- 前提：用户只要求 Code Review。
- 操作：Skill 检查 diff、调用路径和相关测试。
- 预期结果：不修改文件、提交、PR、评论或 OpenATDD 状态；只运行非变异检查。没有 actionable finding 时明确报告“未发现阻塞问题”，并列出测试缺口或未验证边界，而不是制造意见。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 5 步 — AC-05：修复请求与 OpenATDD 问题流衔接

- 前提：Review 已产生有效 finding，用户随后明确要求修复。
- 操作：继续处理该 finding。
- 预期结果：已有相关 task 时进入其 issue/repair 流；否则按复杂度创建新的 Bug 修复任务；保留根因、回归保护和验收证据，不在 Review 阶段偷跑实现。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 6 步 — AC-06：Skill 轻量、可安装且不重复 OpenATDD 内核

- 前提：仓库通过软链和 npm 包向 Codex 提供 Skills。
- 操作：构建并验证 `openatdd-code-review` Skill。
- 预期结果：核心 `SKILL.md` 不超过 4,096 字节；只引用现有 OpenATDD 工件和 CLI，不复制完整运行内核；包含匹配的 `agents/openai.yaml`，进入 npm 包并通过全局软链可从其他项目触发。
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

- 需求：基于 OpenATDD 的验收卡、方案卡和项目规范创建一个轻量只读 Code Review Skill，稳定输出有证据、可操作、按严重级别排序的审查 finding，并与后续修复工作流衔接。
- 阶段：IMPLEMENTING
- 验收批准时间：2026-07-29T00:29:08.761Z
- 方案批准时间：2026-07-29T00:36:48.448Z
- 就绪时间：尚未就绪

### 验收结果

| 验收 | 类型 | 阻塞 | 状态 | 证据 |
|---|---|---:|---|---|
| AC-01 | AUTO | 是 | 未验证 | - |
| AC-02 | AUTO | 是 | 未验证 | - |
| AC-03 | AUTO | 是 | 未验证 | - |
| AC-04 | AUTO | 是 | 未验证 | - |
| AC-05 | AUTO | 是 | 未验证 | - |
| AC-06 | AUTO | 是 | 未验证 | - |

### 项目检查

没有记录项目检查。

### 修复

UAT 前未解决任何缺陷。

### 受影响的历史验收

- detailed-uat-handoff：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- end-to-end-agent-eval：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- fast-portable-finalization：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-1-0：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-mvp：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09
- optimize-atdd-runtime-cost：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- optimize-quick-delivery：AC-01, AC-02, AC-03, AC-04
- strategy-visibility：AC-01, AC-02, AC-03, AC-04

### 人工判断

没有剩余的人工验收项。

### 性能观察

- 环境预检：0 ms
- 预计浏览器往返：1
- ACCEPTANCE_DRAFT：248974 ms
- ACCEPTANCE_APPROVED：11437 ms
- SOLUTION_DRAFT：448250 ms
- CONTRACT_APPROVED：80 ms

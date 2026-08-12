# 验收卡：openatdd-code-review-skill

## 目标

创建一个基于 OpenATDD 合同的轻量只读 Code Review Skill：新模型负责推理，Skill 负责固定审查依据、证据门槛和输出格式；不复制完整交付流程，也不在用户只要求 Review 时修改代码。

## 建议用户旅程

1. 用户提出“审查当前改动、某个分支或 PR”，可选提供基准分支、OpenATDD task、PR 或需求链接。
2. AI 确定 diff 边界，优先读取相关 OpenATDD `acceptance.md`、`solution.md` 和仓库规范；不存在时回退到 PR、issue 或用户描述。
3. AI 只读检查需求符合度、正确性/回归、风险边界、测试证据和实质性可维护性问题，必要时运行不修改工作区的检查。
4. AI 只输出有证据、可操作的 findings，按 P0～P3 排序并定位到 `file:line`；没有问题时明确说明剩余未验证风险。
5. 用户若要求修复，AI 再把有效 finding 转为 OpenATDD issue 或新修复任务；单纯 Review 不自动改代码、发评论或批准 PR。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 审查优先对照已批准的 OpenATDD 合同
- 前提：目标改动关联一个已有验收卡和方案卡的 OpenATDD task。
- 操作：使用新 Skill 审查指定 diff。
- 结果：审查明确区分“是否符合验收/方案”和“代码本身是否正确”，能够指出漏做、错误实现和未要求的范围扩张；仓库规范优先于通用偏好。
- 证据：Skill 契约测试与包含合同偏差的前向评测样例。

### AC-02 [AUTO] [BLOCKING] 无 OpenATDD task 时仍可安全回退
- 前提：目标改动没有可定位的 OpenATDD task。
- 操作：使用 PR/issue/用户描述和仓库规范执行 Review。
- 结果：AI 不伪造需求；能找到规格就继续，规格缺失时只审查可证明的正确性与风险，并明确“需求符合度未验证”。
- 证据：无 task、有 PR 规格和完全无规格三种契约测试。

### AC-03 [AUTO] [BLOCKING] Findings 有统一严重级别和证据门槛
- 前提：diff 中包含可复现或可由调用路径证明的问题，同时包含只属于格式偏好的噪声。
- 操作：执行 Review 并生成结果。
- 结果：每条 finding 包含 P0～P3、标题、紧凑 `file:line`、触发条件、实际影响、代码/测试证据和最小修复或验证方向；按严重性排序，不报告 formatter/linter 可处理的问题，不把猜测写成确定缺陷。
- 证据：输出结构测试、误报抑制样例和行号校验。

### AC-04 [AUTO] [BLOCKING] Review 全程只读且结果诚实
- 前提：用户只要求 Code Review。
- 操作：Skill 检查 diff、调用路径和相关测试。
- 结果：不修改文件、提交、PR、评论或 OpenATDD 状态；只运行非变异检查。没有 actionable finding 时明确报告“未发现阻塞问题”，并列出测试缺口或未验证边界，而不是制造意见。
- 证据：只读约束测试、工作区哈希对比与无 finding 样例。

### AC-05 [AUTO] [BLOCKING] 修复请求与 OpenATDD 问题流衔接
- 前提：Review 已产生有效 finding，用户随后明确要求修复。
- 操作：继续处理该 finding。
- 结果：已有相关 task 时进入其 issue/repair 流；否则按复杂度创建新的 Bug 修复任务；保留根因、回归保护和验收证据，不在 Review 阶段偷跑实现。
- 证据：Skill 路由文本、OpenATDD 回归测试和模拟 Review→Fix 旅程。

### AC-06 [AUTO] [BLOCKING] Skill 轻量、可安装且不重复 OpenATDD 内核
- 前提：仓库通过软链和 npm 包向 Codex 提供 Skills。
- 操作：构建并验证 `openatdd-code-review` Skill。
- 结果：核心 `SKILL.md` 不超过 4,096 字节；只引用现有 OpenATDD 工件和 CLI，不复制完整运行内核；包含匹配的 `agents/openai.yaml`，进入 npm 包并通过全局软链可从其他项目触发。
- 证据：字节数、Skill Creator 校验、包清单、软链解析和仓库外触发检查。

## 边界

- 不把纯 Review 变成新的 OpenATDD delivery task；本任务只是开发 Review Skill 本身。
- 不默认调用多个 Agent；只有大型或高风险改动且独立视角有明确价值时才允许有界只读复核。
- 不自动发布 GitHub/GitLab 评论、批准 PR、修改代码或执行生产操作。
- 不承诺 AI Review 替代测试、静态分析、安全扫描或最终人工合并决策。
- 首版面向本地 Git diff、分支和 PR 工作区；平台评论发布与团队策略配置不在范围内。

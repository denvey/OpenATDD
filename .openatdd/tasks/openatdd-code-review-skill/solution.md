# 方案卡：openatdd-code-review-skill

<!-- openatdd:recommendation -->
## 推荐方案

新增独立的 `openatdd-code-review` Codex Skill，而不是把 Review 塞进完整 `openatdd` Skill。它只复用 OpenATDD 已批准的验收卡、方案卡和 issue/repair 入口：Review 阶段保持只读、单模型、短上下文；用户明确要求修复后才转回 OpenATDD 交付流程。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 当前 `openatdd` 已把需求合同、方案、影响路径、修复 epoch 和 UAT 证据结构化，Review 可直接把这些工件作为规格来源，无需再设计一套 PRD 协议。
- 新模型已有代码推理能力，Skill 只需固定 diff 边界、规格优先级、证据门槛和输出格式；不需要新的 CLI、服务、数据库或第三方依赖。
- 独立 Skill 可避免用户只要求 Review 时触发验收/方案门禁和写状态，同时仍能在 Review→Fix 时复用现有 issue/repair 流。
- 仓库已有 Skill Creator、npm `files` 和全局软链安装模式，可增量加入第二个 Skill。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 用 Skill Creator 初始化 `skills/openatdd-code-review/`，生成不超过 4,096 字节的 `SKILL.md` 和匹配的 `agents/openai.yaml`。
- Skill 规定两条独立审查轴：**Spec** 对照 OpenATDD/PR/issue；**Correctness** 检查逻辑、调用路径、风险、回归和测试。仓库规范覆盖通用偏好。
- 固定 findings-first 输出：P0～P3、`file:line`、触发条件、影响、证据、最小修复/验证方向；无问题时输出剩余风险，不制造风格意见。
- 增加确定性契约测试和有/无 OpenATDD 规格的前向样例；更新 npm 包清单、README 和本机全局软链。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **Skill 变成另一套大工作流**：4 KB 硬上限，只保留 Review 核心；OpenATDD 状态、finalization 和 UAT 仍由原 Skill/CLI 负责。
- **误报或无依据结论**：每条 finding 必须有紧凑行号、可达触发路径和实际影响；不确定项只能列为待验证风险。
- **Review 偷跑修改**：明确禁止写文件、提交、评论、批准 PR 和变更 OpenATDD 状态；测试对工作区哈希做前后比较。
- **自动关联错 task**：用户指定优先；只能定位一个相关已批准 task 时自动采用；多候选时先询问，找不到则诚实回退。
- **新增 Skill 未被其他项目发现**：包清单、软链解析和仓库外触发检查共同验证安装。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不新增 GitHub/GitLab 自动评论、自动批准、合并或外部通知。
- 不默认启动多个 Agent，也不把 formatter、linter 和已有静态检查重复成人工 finding。
- 不为首版实现平台专用 PR API、团队审批策略、Web UI 或新的 OpenATDD CLI 命令。
- 不声称 AI Review 替代测试、安全扫描和人工合并判断。
<!-- /openatdd:exclusions -->

## 实现细节

- 运行 Skill Creator 的 `init_skill.py` 创建 `openatdd-code-review`，只生成必要的 `SKILL.md` 与 `agents/openai.yaml`，不创建 README、模板资产或运行时脚本。
- Review 目标解析顺序：用户给定 base/task → PR/分支元数据 → 唯一相关 OpenATDD task → 当前工作树；基准无效、diff 为空或规格存在多个候选时停止并说明。
- 规格顺序：已批准 OpenATDD `acceptance.md` + `solution.md` → PR/issue → 用户描述；完全无规格时跳过 Spec 结论，只报告可证明的 correctness/risk finding。
- 只读检查允许 `git diff/log/show`、文本检索、目标读取和不会改写工作区的测试；禁止 formatter、fix 模式、安装依赖、写评论或任何产品文件修改。
- Review→Fix 只有在用户明确授权后发生：相关 task 存在则恢复并进入 issue/repair；否则交给 `$openatdd` 按复杂度创建 Bug 修复任务。
- `tests/code-review-skill.test.mjs` 验证大小、触发描述、两轴来源、只读约束、严重级别、无 finding 语义、fallback、fix handoff、UI 元数据、包清单和 README；Skill Creator `quick_validate.py` 验证结构。
- 使用两个隔离的只读前向样例验证“规格偏差可发现”和“无规格不伪造”，仅把原始 fixture 交给 reviewer，不泄漏预期答案。

## 影响路径

- `skills/openatdd-code-review/SKILL.md`
- `skills/openatdd-code-review/agents/openai.yaml`
- `tests/code-review-skill.test.mjs`
- `package.json`
- `README.md`
- `/Users/denvey/.codex/skills/openatdd-code-review`（软链）

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | OpenATDD 合同优先的 Spec 轴与独立 Correctness 轴 | 合同偏差 fixture、Skill 契约测试与前向样例 |
| AC-02 | PR/issue/用户描述回退与无规格诚实降级 | 三种规格来源测试和无规格样例 |
| AC-03 | P0～P3 findings-first 证据格式与噪声抑制 | 输出规则断言、行号/证据 fixture |
| AC-04 | 只读命令白名单语义和 no-findings/residual-risk 输出 | 工作区哈希前后对比、无 finding 样例 |
| AC-05 | 显式授权后转入现有 issue/repair 或新 `$openatdd` task | Review→Fix 路由契约测试 |
| AC-06 | 4 KB Skill、UI metadata、npm 分发、README 与全局软链 | quick_validate、字节数、npm pack、readlink、仓库外发现检查 |

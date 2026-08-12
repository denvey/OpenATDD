# 方案卡：lightweight-project-truth

<!-- openatdd:recommendation -->
## 推荐方案

新增唯一的 `.openatdd/knowledge/project.md`，只保存当前仍有效的产品规则、架构边界和关键技术决策。`openatdd init` 负责安全补齐模板；现有知识图谱把它索引为 `ProjectTruth`，所有复杂度 lane 的实现与验证上下文都自动携带一个来源摘要引用。正文不复制到任务状态或常规 CLI 输出，Agent 只在需要时读取这一份短文件。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用已经存在的 `.openatdd/knowledge`、source digest、图谱自动重建和 scoped context，不增加数据库、服务或状态机。
- `ProjectTruth` 表达“系统现在是什么”，incident / invariant / task / decision 继续表达“为什么变成这样”和“以前错过什么”，职责互补而不重复。
- 一份普通 Markdown 可由懂技术的人审查和维护，也允许不懂代码的人只维护产品规则；当前版本不让 AI 静默改写它。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 初始化时创建三段式项目事实模板，并保证重复初始化不覆盖已有内容。
- 图谱新增一个有来源摘要的 `ProjectTruth` 节点；常规任务知识摘要只暴露路径、摘要和大小，不回传全文。
- Quick、Standard、Deep 的实现与验证上下文都自动加入该引用；文件变化沿用现有 stale/rebuild 机制。
- 补齐确定性测试，并在 Skill / README 说明项目事实只保留当前状态、保持短小。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 文件长期膨胀会重新增加上下文成本：模板明确限制为当前事实和短条目，任务上下文只保存一个引用，不复制正文。
- 过期事实比没有事实更危险：文件摘要参与图谱和上下文失效检查，人工修改后自动重建；历史内容明确移交 Git、task、decision 和 incident。
- 全局事实可能与局部实现不相关：只增加一个短文件引用，不把全文嵌入状态或每次 CLI 回包；局部标准仍由现有相关性检索负责。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不增加 Vision、Epic、Issue、ADR 管理体系，不增加新的人工确认、命令、模型调用、后台同步或自动写事实行为。
- 不把生成图谱升级为事实源，也不替代可执行回归测试、incident、不变量或历史验收重放。
<!-- /openatdd:exclusions -->

## 实现细节

- `workflow.mjs` 的项目路径和 `initProject` 增加 `projectTruth`，以 create-if-missing 方式写入短模板。
- `graph.mjs` 读取该文件并生成单一 `ProjectTruth` 节点，保存 path / SHA-256 / size；文件继续进入图谱 `sources`，因此现有 `graphStaleness` 能发现变化。
- `context.mjs` 将 `ProjectTruth` 纳入类型映射，并独立于关键词匹配把当前非 stale 节点加入 implementation / verification；`sourceDigests` 自动使旧 context 失效。
- `workflow.mjs` / `openatdd.mjs` 在 `new`、`assess` 的知识摘要中返回和显示精简的 project-truth 元数据，同时从普通 graph matches 中去掉该正文，避免重复 Token。
- 测试覆盖新旧项目初始化、非覆盖、三种 lane 自动引用、CLI 精简输出、图谱与上下文变更失效，以及现有知识能力回归。

## 影响路径

- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/graph.mjs`
- `skills/openatdd/scripts/context.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `tests/workflow.test.mjs`
- `tests/knowledge.test.mjs`
- `README.md`
- `skills/openatdd/SKILL.md`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 初始化单一三段式模板并采用 create-if-missing | 新旧项目初始化和重复初始化测试 |
| AC-02 | 图谱生成 `ProjectTruth`，所有 lane 上下文自动添加来源引用，CLI 只显示元数据 | CLI 创建任务与 Quick/Standard/Deep context 集成测试 |
| AC-03 | 项目事实摘要进入 graph sources 和 context sourceDigests | 修改事实后的 graph/context stale 与重建测试 |
| AC-04 | 复用现有知识架构，不增加流程状态、模型或服务 | 现有 workflow/knowledge 回归与 `npm run check` |

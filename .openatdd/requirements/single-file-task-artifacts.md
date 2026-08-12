# 需求交付：single-file-task-artifacts

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已完成实现与自动验证
- 合并建议：可以合并

## 交付结论

OpenATDD 已改为每个需求只在工作区保留一份 `.openatdd/requirements/<task-id>.md`。机器状态、证据、预演、图谱、观察记录和事务恢复数据统一进入 Git 私有 `openatdd` 目录；普通仓库和 linked worktree 均已通过真实测试。

## 人工验收入口

本需求的阻塞验收均为 AUTO，无需人工重复自动测试。如需快速抽查：

1. 在临时 Git 项目执行 `openatdd new sample --requirement "Sample"`。
2. 预期工作区只出现 `.openatdd/requirements/sample.md` 这一份任务文件；不得出现 `.openatdd/tasks/`、`state.json` 或 `evidence/`。
3. 打开该 Markdown，预期先看到状态、合并建议、交付结论、人工验收入口、Reviewer 重点和实际变更摘要。
4. 如发现失败，请反馈命令、`git status --short` 输出和实际目录清单；沿同一任务的 issue/repair 链路处理。

## Reviewer 重点

- 验收与方案使用独立章节摘要，更新顶部交付区不会破坏批准状态。
- `git rev-parse --path-format=absolute --git-path openatdd` 正确覆盖普通仓库和 linked worktree。
- MANUAL 与 ASSISTED 都会在顶部展示环境、入口、身份、凭据变量、前置条件、时间、步骤、预期和反馈方式。
- 旧 `.openatdd/tasks/**` 和公开机器索引已经删除，不提供兼容或迁移分支。

## 实际变更与验收摘要

- 重构合同、工作流、图谱、上下文、manifest、finalization、证据定位符和事务边界。
- 新增真实 Git 与 linked worktree 单文件存储测试。
- 更新 README、OpenATDD Skill、Code Review Skill、references 与评测场景。
- 删除仓库内旧任务、graph、observations、incidents/index 和 reverification 等公开运行产物。
- `npm test`：150/150 通过。
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：single-file-task-artifacts

## 目标

让 OpenATDD 每次需求在普通工作区只产生一个面向人的 Markdown 文件，同时保留可靠的审批、恢复、验证和追溯能力；Reviewer 打开文件第一屏即可判断交付状态并在需要时直接执行人工验收。

## 建议用户旅程

1. 用户在已初始化的 Git 项目中创建并推进一个 OpenATDD 需求。
2. 工作区只出现 `.openatdd/requirements/<task-id>.md`，机器状态和运行产物进入 Git 私有 OpenATDD 目录。
3. 验收与方案在同一文件中逐步完善，但保持独立审批边界。
4. 交付后先阅读决策摘要和验收入口，需要追溯时再继续阅读合同和明细。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 每个需求只产生一个可见任务文件
- 前提：一个已初始化的 Git 项目没有该 task ID 的 OpenATDD 任务。
- 操作：创建任务并推进完整生命周期。
- 结果：工作区中该需求始终只有 `.openatdd/requirements/<task-id>.md`，不创建公开 task 目录或独立合同、报告、状态和证据文件。
- 证据：真实 Git 生命周期和目录断言测试。

### AC-02 [AUTO] [BLOCKING] 单文件保留独立合同完整性
- 前提：唯一需求文件包含验收、方案和交付章节。
- 操作：分别修改已批准验收、方案或交付摘要。
- 结果：验收和方案按章节独立校验；合同变化触发漂移门禁，交付区更新不破坏批准。
- 证据：审批、章节摘要、漂移和交付更新回归测试。

### AC-03 [AUTO] [BLOCKING] 运行数据使用 Git 私有存储
- 前提：项目位于普通 Git 仓库或 linked worktree。
- 操作：执行状态、上下文、图谱、证据、事务恢复和 finalization。
- 结果：机器数据进入正确的 Git 私有目录，工作区和 Git 提交候选中不可见，任务仍可恢复。
- 证据：普通仓库与 linked worktree 真实测试、全量工作流测试。

### AC-04 [AUTO] [BLOCKING] 第一屏按 Reviewer 决策顺序呈现
- 前提：任务完成自动验证。
- 操作：打开唯一需求文件。
- 结果：顶部依次展示状态/合并建议、交付结论、人工验收入口、Reviewer 重点、实际变更和验收摘要。
- 证据：中英文渲染和章节顺序测试。

### AC-05 [AUTO] [BLOCKING] 人工验收操作链路完整且状态诚实
- 前提：存在阻塞的 MANUAL 或 ASSISTED 标准。
- 操作：完成自动 finalization 并打开唯一需求文件。
- 结果：顶部显示等待人工验收，并包含环境、入口、身份、凭据变量、前置条件、时间、步骤、预期、判断和失败反馈；显式人工确认后显示已验收。
- 证据：AUTO、ASSISTED、MANUAL 和 human-confirmed 回归测试。

### AC-06 [AUTO] [BLOCKING] 最终真实改动与批准范围比对
- 前提：方案记录影响路径且实现基线已冻结。
- 操作：finalization 计算真实增删改文件。
- 结果：需求文件展示实际变更；无法归属或越界路径产生范围漂移并阻止可合并建议。
- 证据：源码 inventory、scope drift 和脏工作区归属测试。

### AC-07 [AUTO] [BLOCKING] 项目级共享内容保持精简
- 前提：检查 `.openatdd` 和 Git 私有目录。
- 操作：初始化项目并查看版本控制候选。
- 结果：共享配置、环境档案、project truth、standards/research 和单份需求文件可提交；任务运行态与可重建索引不进入工作区。
- 证据：初始化、打包、文档和真实 Git 状态测试。

## 边界

- 不兼容或迁移旧 `.openatdd/tasks/**`。
- 不引入 SQLite 或新的运行时依赖。
- 原始成功日志不复制到唯一需求文件。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# 方案卡：single-file-task-artifacts

<!-- openatdd:recommendation -->
## 推荐方案

使用“一份公开需求文档 + Git 私有文件式运行时”。组合 Markdown 负责渐进式人类阅读，现有 JSON/Markdown 运行结构继续用于机器恢复与证据，但全部位于 Git 私有目录。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有状态机、证据、原子事务和 finalization，实现范围可控。
- section-level digest 保留两个审批门禁，同时允许顶部交付内容持续更新。
- Git 私有路径天然不污染工作区，并正确覆盖 linked worktree。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 新增组合 requirement 文档 marker、章节提取和定向替换。
- 将任务运行态、graph、observations、memory 和事务迁入 Git 私有目录。
- finalization 更新唯一 requirement 的顶部交付区，并展示人工验收完整链路。
- 增加稳定 `project:` / `git:` artifact locator 与双根事务保护。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 组合文档误写可能破坏合同，通过严格 marker、章节摘要和回归测试防护。
- linked worktree 私有目录位于工作区外，通过 Git 官方路径解析与双根限制防护。
- 并行用户改动可能被错误归属，通过创建基线和实现基线区分。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不提供旧任务读取或迁移。
- 不引入数据库或外部服务。
- 不把机器原始日志和秘密值写入需求文件。
<!-- /openatdd:exclusions -->

## 实现细节

- 公开路径固定为 `.openatdd/requirements/<task-id>.md`。
- 私有根通过 `git rev-parse --path-format=absolute --git-path openatdd` 解析。
- 正式事务只允许写工作区根和已解析 Git 私有根。
- 显式人工通过使用 `openatdd record TASK --acceptance AC-01 --status manual --human-confirmed`。

## 影响路径

- `skills/openatdd`
- `skills/openatdd-code-review`
- `tests`
- `evals/agent`
- `README.md`
- `.openatdd`
- `.gitignore`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 唯一公开 requirement 与私有 taskFiles 映射 | Git 生命周期与目录测试 |
| AC-02 | section parser、digest 和定向更新 | 合同漂移与更新测试 |
| AC-03 | Git 私有路径、locator、双根事务 | 普通仓库、worktree、恢复测试 |
| AC-04 | 顶部交付 renderer | 章节顺序和语言测试 |
| AC-05 | ASSISTED/MANUAL 链路与 human-confirmed | finalization 与状态测试 |
| AC-06 | 创建/实现 inventory 与 scope drift | fingerprint 和 finalization 测试 |
| AC-07 | 精简项目布局和文档同步 | init、package、Skill 与 Git 状态测试 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 验证与追溯明细

- `npm test`：150 项测试全部通过。
- 真实普通 Git 仓库：只产生一个 task requirement 文件，机器 state 位于 Git 私有目录。
- 真实 linked worktree：私有运行目录正确解析到 worktree Git 元数据之外，resume 可用。
- 旧 schema 和 `READY_FOR_UAT` 兼容分支已删除。
<!-- /openatdd:details -->

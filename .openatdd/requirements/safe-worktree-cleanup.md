# 需求交付：safe-worktree-cleanup

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已验收
- 合并建议：可以合并

## 交付结论

自动验证已完成，验证 epoch 为 2。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：无计划外变更
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/references/verification-routing.md
- M skills/openatdd/scripts/openatdd.mjs
- M skills/openatdd/scripts/orchestration-contracts.mjs
- M skills/openatdd/scripts/state.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/orchestration-docs.test.mjs
- M tests/orchestration-workflow.test.mjs
- M tests/orchestration.test.mjs

### Worktree 清理

- 结果：completed
- 汇总：cleaned 0, retained 0, failed 0

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：safe-worktree-cleanup

## 目标

任务成功交付后自动清理该任务创建且已安全集成的 worktree；异常或无法证明安全时保留并报告。

## 建议用户旅程

1. 一个使用隔离 worktree 开发的任务完成集成和正式交付。
2. 主控识别该任务实际创建并绑定的 worktree，逐个验证来源仓库、路径身份、session 集成状态和未交付改动。
3. 主控自动移除全部通过安全校验的 worktree，并记录清理结果。
4. 任一 worktree 无法证明安全时不强制删除，保留现场并在交付摘要中说明原因和后续动作。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 成功交付后清理本任务创建的安全 worktree
- 前提：多会话任务已进入 DELIVERED，开发 session 已完成安全集成，并记录了由本任务创建的 worktree 身份。
- 操作：主控执行交付后清理。
- 结果：所有满足清理条件的 worktree 从 Git worktree 列表和文件系统中移除，主控 checkout、分支、任务状态和交付证据保持不变。
- 证据：真实临时 Git worktree 集成测试、CLI 清理结果和清理后 worktree 列表。

### AC-02 [AUTO] [BLOCKING] 清理前验证身份、集成状态和未交付内容
- 前提：任务记录一个候选 worktree。
- 操作：主控校验该路径不是主控 checkout，属于同一 Git common-dir，身份与已绑定 session 一致，session 为 integrated，且实际改动已进入交付候选。
- 结果：只有全部条件通过的 worktree 才允许删除；外部 worktree、身份漂移、未集成 session、未跟踪或未交付改动均失败关闭。
- 证据：主控路径、外部仓库、身份漂移、脏 worktree 和未集成状态负向测试。

### AC-03 [AUTO] [BLOCKING] 异常任务保留 worktree 并报告
- 前提：任务 failed、blocked、needs_input、conflict、尚未 DELIVERED，或某个 worktree 无法通过安全校验。
- 操作：主控尝试生成清理计划或执行清理。
- 结果：不使用强制删除，不丢失现场；结果逐项标记 cleaned、retained 或 failed，并给出稳定原因和可执行后续动作。
- 证据：部分成功、重复调用幂等、失败保留与状态摘要测试。

## 边界

- 删除授权仅覆盖由当前 OpenATDD 任务创建并记录、已安全集成的开发 worktree。
- 不删除主控 checkout、Git 分支、任务会话、远端分支、提交、OpenATDD 私有状态或交付证据。
- 不使用 `git worktree remove --force`；任何未交付内容或身份不确定性都保留现场。
- 默认在正式交付成功后由主控执行；清理失败不改写已完成的产品验收，但必须在交付摘要中显式报告。
- Quick、单会话和没有创建 worktree 的任务保持无操作且幂等。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
<!-- openatdd:recommendation -->
# 方案卡：safe-worktree-cleanup

## 推荐方案

增加一个主控专用的 `orchestration-cleanup TASK` 交付后命令，并由 OpenATDD Skill 在正式 `DELIVERED` 后自动调用。命令只处理当前任务 session 已绑定、已集成且身份未漂移的 worktree；先用 Git 与已记录基线证明 worktree 的全部差异都已进入交付候选，再移除这些已交付差异并使用普通 `git worktree remove` 清理。任何未知文件、身份不符、未集成或无法证明等价的内容都失败关闭，保留 worktree 并逐项报告。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 orchestration 的 controller、session worktree、Git common-dir、不可变 branch/base identity、实际 diff 和 `integrated` 状态，不引入第二套 worktree 注册表。
- 清理发生在正式交付事务之后；即使文件系统或 Git 清理失败，产品交付仍保持 `DELIVERED`，同时留下可重试的结构化结果。
- 保持核心宿主无关：OpenATDD 提供确定性安全校验和 CLI，Codex App Skill 只负责在交付成功后调用，不直接耦合私有线程 API。
- 不使用 `--force`。因为 worker 成果可能以未提交差异形式被复制到主候选，只有精确证明其全部差异已集成后才允许清除这些已交付差异，再让普通 Git worktree 删除承担最后一道脏目录保护。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 在 orchestration 合同中增加清理资格和逐项结果的纯函数合同，稳定区分 `cleaned`、`retained`、`failed` 及原因码。
- 在 workflow 增加主控专用交付后清理：验证任务为 `DELIVERED`、controller 路径、同一 Git common-dir、session/worktree 不可变身份、`integrated` 状态和实际差异已进入交付候选。
- 对可证明安全但仍含已交付差异的 worktree，仅恢复已验证的 tracked/untracked 变更；忽略文件、嵌套仓库、子模块、越界或未知内容一律保留。随后仅调用无 `--force` 的 `git worktree remove`。
- 新增 `orchestration-cleanup TASK [--json]` CLI，并把幂等清理摘要保存到任务的 orchestration cleanup 状态与历史中；无 worktree 的任务返回成功 no-op。
- 更新 Skill、治理说明、README 和验证说明：正式交付后调用清理；清理失败不回滚交付，必须在最终摘要中报告保留路径、原因和后续动作。
- 增加真实临时 Git 仓库/worktree 测试，覆盖安全清理、主控/外部/漂移/脏/未集成保留、部分成功与重复调用。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **误删未交付内容**：候选必须同时通过任务来源、Git 身份、集成状态和差异等价验证；未知、忽略、嵌套或无法分类内容全部保留，不使用强制删除。
- **集成后 worktree 仍然脏**：只清除已由 session result 和主候选证明完成集成的差异；清除后再次验证为空，再交给普通 `git worktree remove`。
- **清理失败破坏成功交付**：清理是 `DELIVERED` 后的独立后处理；错误写入 cleanup 摘要并允许重试，不改变产品验收结论。
- **路径漂移或重复调用**：使用 realpath、Git top-level/common-dir、记录身份和当前 worktree inventory 交叉校验；已移除路径返回幂等 `cleaned`/`not_present`，不误报故障。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不删除主控 checkout、Git 分支、远端引用、提交、任务、session、私有状态或验收证据。
- 不清理 failed、blocked、needs_input、conflict、未集成或尚未 `DELIVERED` 的任务现场。
- 不使用 `git worktree remove --force`，不对来源不明的历史 worktree 做路径猜测或批量清扫。
- 不把清理并入 finalization 原子事务，也不因清理失败撤销成功交付。
- 不改变 Quick、单会话或未创建 worktree 的执行路径；它们保持 no-op。
<!-- /openatdd:exclusions -->

## 实现细节

### 清理资格

- 从当前任务 `execution.orchestration.sessions` 读取候选，不扫描目录推断所有权。
- 任务必须为 `DELIVERED`；session 必须为 `integrated`，且记录了 worktree、Git common-dir、top-level、branch identity、base revision 与已集成 changed paths。
- controller checkout 与候选必须分别 realpath；候选不得等于 controller，且当前 Git 身份必须与创建时记录完全一致。

### 未交付内容保护

- 重新计算 worktree 相对其记录基线的实际差异，并与 session result、integration 记录和当前主候选逐项比对。
- 仅当每个新增、修改、删除都属于已集成 changed paths，且主候选内容与已验证 worker 结果一致时，才允许清除 worker 副本。
- `git status --porcelain --ignored` 发现未纳入证明的 untracked/ignored 内容、嵌套仓库或子模块时返回 `retained`。
- 清除后再次要求工作树为空，再执行 `git worktree remove <exact-path>`；绝不传 `--force`。

### 状态与宿主调用

- `execution.orchestration.cleanup` 保存最近 attempt、逐 session 结果、时间和汇总；重复调用跳过已不存在且已记录清理的路径。
- CLI 始终返回完整逐项结果；只有合同/状态调用错误令命令失败，单个文件系统清理错误作为 `failed` 项保留并报告。
- Skill 在唯一一次成功 `finalize --fast` 返回 `DELIVERED` 后调用 cleanup；随后直接向使用者汇报交付和清理结果，不重新运行 finalization。

## 影响路径

- `skills/openatdd/scripts/orchestration-contracts.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/scripts/state.mjs`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`
- `skills/openatdd/references/verification-routing.md`
- `README.md`
- `tests/orchestration.test.mjs`
- `tests/orchestration-workflow.test.mjs`
- `tests/orchestration-docs.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | `orchestration-cleanup`、交付后 Skill 调用与普通 Git worktree remove | 已交付集成 worktree 从 Git inventory 和文件系统消失，主控、分支、状态与证据不变 |
| AC-02 | controller/session/Git identity、差异等价、未知内容失败关闭合同 | controller、外部仓库、身份漂移、dirty/ignored、未交付内容和未集成负向测试 |
| AC-03 | cleanup 逐项状态、历史摘要和幂等重试 | failed/blocked/needs_input/conflict、部分成功、删除失败保留和重复调用测试 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。
<!-- /openatdd:details -->

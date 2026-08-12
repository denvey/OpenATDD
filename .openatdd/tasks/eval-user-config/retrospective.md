# 策略回溯：eval-user-config

## 一屏结论

- 任务深度：quick（局部范围，已有项目模式，低不确定性）
- 选择能力：验收优先与风险分层确认、Quick / Standard / Deep 自适应深度、推荐式人类决策、渐进方案与简洁性审查、事故、不变量与长期知识、证据门禁、恢复与原子 Finalization、真实 Agent、裸基线与能力消融评测
- 实际观察：验收优先与风险分层确认、Quick / Standard / Deep 自适应深度、渐进方案与简洁性审查、作用域上下文与恢复、事故、不变量与长期知识、证据门禁、恢复与原子 Finalization、真实 Agent、裸基线与能力消融评测
- 未调用：推荐式人类决策、条件式 Agent 与独立审查、按风险启用外部调研
- 确认 / 决策 / Agent / 修复：2 / 0 / 0 / 1
- 自主交付 / 总墙钟：8m 34s / 13m 33s

## 能力与来源

| 能力 | 借鉴来源 | 策略选择 | 实际调用 | 证据 |
|---|---|---|---|---|
| 验收优先与风险分层确认 | [OpenATDD / ATDD](https://github.com/denvey/OpenATDD)、[GitHub Spec Kit](https://github.com/github/spec-kit) | 已选择：核心交付合同 | 已实际观察 | [state.json](state.json)：已记录 2/2 个合同批准 |
| Quick / Standard / Deep 自适应深度 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis) | 已选择：任务深度：quick | 已实际观察 | [state.json](state.json)：深度=quick；原因=local-scope,established-project-pattern,low-uncertainty |
| 推荐式人类决策 | [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：仅在存在实质决策时询问人 | 未使用 | [state.json](state.json)：本次没有需要人的实质决策 |
| 渐进方案与简洁性审查 | [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)、[GitHub Spec Kit](https://github.com/github/spec-kit)、[Superpowers](https://github.com/obra/superpowers) | 已选择：验收标准已批准 | 已实际观察 | [state.json](state.json)：方案审查=passed；审查者=main |
| 作用域上下文与恢复 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis)、[Agent OS](https://github.com/buildermethods/agent-os) | 未使用：Quick 在内存中保持精简上下文 | 已实际观察 | [state.json](state.json)：上下文摘要=0942bd3598ca7b47b1c145e279c8a80edbd726a4f6578f7010d2194149e6e9bf |
| 条件式 Agent 与独立审查 | [Superpowers](https://github.com/obra/superpowers)、[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)、[GSD Core](https://github.com/open-gsd/gsd-core) | 未使用：任务深度：quick；未选择 Agent 角色 | 未使用 | [state.json](state.json)：没有记录 Agent 调用 |
| 按风险启用外部调研 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis) | 未使用：任务深度：quick；本地调查已经足够 | 未使用 | [state.json](state.json)：没有记录外部调研调用 |
| 事故、不变量与长期知识 | [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)、[CodeStable](https://github.com/codestable/CodeStable)、[Agent OS](https://github.com/buildermethods/agent-os) | 已选择：启用作用域记忆与影响策略 | 已实际观察 | [state.json](state.json)：1 个已解决问题；6 个受影响历史任务 |
| 证据门禁、恢复与原子 Finalization | [Comet](https://github.com/rpamis/comet)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：确定性交付合同 | 已实际观察 | [finalize-result.json](finalize-result.json)：epoch=6; fingerprint=db98538cfa2bb7da6e27f849ce811d4178b7004e92ebc0249f63419140450191 |
| 真实 Agent、裸基线与能力消融评测 | [Comet](https://github.com/rpamis/comet)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：已提供评测报告 | 已实际观察 | [user-config-speed.json](../../../evals/reports/user-config-speed.json)：scenario=agent-simplicity-v1 |

## 效果指标

- 预检尝试 / 失败：1 / 0
- 已解决问题 / 修复尝试：1 / 0
- Agent 关键路径 / 整合尾巴：0s / 0s
- 验收状态：passed=3, manual=0, failed=0, affected=0, unverified=0
- 检查状态：passed=2, failed=0, affected=0, other=0
- Finalization：34524 ms，4 次命令

### 评测组

| 组 | 场景 | 通过率 | 首次验收 | 输入 / 缓存 / 输出 Token | 耗时 |
|---|---|---:|---:|---:|---:|
| full | agent-simplicity-v1 | 100% | 100% | 51803 / 11520 / 765 | 48193 ms |
| bare | agent-simplicity-v1 | 100% | 100% | 40240 / 11520 / 551 | 40445 ms |

### 阶段耗时

| 阶段 | 耗时 |
|---|---:|
| IMPLEMENTING | 6m 51s |
| ACCEPTANCE_DRAFT | 4m 13s |
| PRE_UAT | 1m 43s |
| READY_FOR_UAT | 45s |
| CONTRACT_APPROVED | 0s |
| ACCEPTANCE_APPROVED | 0s |
| REPAIRING | 0s |
| SOLUTION_DRAFT | 0s |

### 最大事件间隔

| 从 | 到 | 间隔 |
|---|---|---:|
| SCOPED_CONTEXT_PREPARED | FINALIZATION_COMPLETED | 4m 16s |
| SCOPED_CONTEXT_PREPARED | ISSUE_RESOLVED | 2m 46s |
| TASK_ASSESSED | ACCEPTANCE_APPROVED | 2m 14s |
| ACCEPTANCE_REOPENED | ACCEPTANCE_APPROVED | 1m 58s |
| UAT_PLANNED | FINALIZATION_COMPLETED | 1m 19s |

## 优化建议

- **减少 · 上下文开销**：相对 bare，质量相同但多使用 11563 个输入 Token；建议精简注入上下文后复测。
- **保留 · 条件式 Agent 与独立审查**：本次未调用 Agent，条件式策略避免了不必要的多 Agent 成本。

## 解释边界

- 借鉴来源表示设计启发，不表示运行外部框架。
- 策略选择、实际调用和效果相关性分开展示；单次对照不能证明因果。
- 缺失数据保持不可用，不由模型猜测补全。

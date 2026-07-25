# 策略回溯：strategy-visibility

## 一屏结论

- 任务深度：standard（跨模块范围，项目模式部分建立，中等不确定性）
- 选择能力：验收优先与双确认、Quick / Standard / Deep 自适应深度、推荐式人类决策、渐进方案与简洁性审查、作用域上下文与恢复、条件式 Agent 与独立审查、事故、不变量与长期知识、证据门禁、恢复与原子 Finalization、真实 Agent、裸基线与能力消融评测
- 实际观察：验收优先与双确认、Quick / Standard / Deep 自适应深度、渐进方案与简洁性审查、作用域上下文与恢复、事故、不变量与长期知识、证据门禁、恢复与原子 Finalization、真实 Agent、裸基线与能力消融评测
- 未调用：推荐式人类决策、条件式 Agent 与独立审查、按风险启用外部调研
- 确认 / 决策 / Agent / 修复：2 / 0 / 0 / 0

## 能力与来源

| 能力 | 借鉴来源 | 策略选择 | 实际调用 | 证据 |
|---|---|---|---|---|
| 验收优先与双确认 | [OpenATDD / ATDD](https://github.com/denvey/OpenATDD)、[GitHub Spec Kit](https://github.com/github/spec-kit) | 已选择：核心交付合同 | 已实际观察 | [state.json](state.json)：已记录 2/2 次确认 |
| Quick / Standard / Deep 自适应深度 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis) | 已选择：任务深度：standard | 已实际观察 | [state.json](state.json)：深度=standard；原因=cross-module-scope,partial-project-pattern,medium-uncertainty |
| 推荐式人类决策 | [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：仅在存在实质决策时询问人 | 未使用 | [state.json](state.json)：本次没有需要人的实质决策 |
| 渐进方案与简洁性审查 | [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)、[GitHub Spec Kit](https://github.com/github/spec-kit)、[Superpowers](https://github.com/obra/superpowers) | 已选择：验收标准已批准 | 已实际观察 | [state.json](state.json)：方案审查=passed；审查者=main |
| 作用域上下文与恢复 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis)、[Agent OS](https://github.com/buildermethods/agent-os) | 已选择：任务深度：standard | 已实际观察 | [context.json](context.json)：上下文摘要=624302e4e8b12f25e44b2d48f657d4ada5b230908cf9bed2f105c41f78be67b5 |
| 条件式 Agent 与独立审查 | [Superpowers](https://github.com/obra/superpowers)、[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)、[GSD Core](https://github.com/open-gsd/gsd-core) | 已选择：任务深度：standard；可选角色：independent-review | 未使用 | [state.json](state.json)：没有记录 Agent 调用 |
| 按风险启用外部调研 | [GSD Core](https://github.com/open-gsd/gsd-core)、[Trellis](https://github.com/mindfold-ai/Trellis) | 未使用：任务深度：standard；本地调查已经足够 | 未使用 | [state.json](state.json)：没有记录外部调研调用 |
| 事故、不变量与长期知识 | [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)、[CodeStable](https://github.com/codestable/CodeStable)、[Agent OS](https://github.com/buildermethods/agent-os) | 已选择：启用作用域记忆与影响策略 | 已实际观察 | [state.json](state.json)：0 个已解决问题；4 个受影响历史任务 |
| 证据门禁、恢复与原子 Finalization | [Comet](https://github.com/rpamis/comet)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：确定性交付合同 | 已实际观察 | [finalize-result.json](finalize-result.json)：epoch=2; fingerprint=46be2bb44c2f7aec006f4726336097d381f1d840b037c44f6285edc59fc136ae |
| 真实 Agent、裸基线与能力消融评测 | [Comet](https://github.com/rpamis/comet)、[OpenATDD / ATDD](https://github.com/denvey/OpenATDD) | 已选择：已提供评测报告 | 已实际观察 | [strategy-visibility-real.json](../../../evals/reports/strategy-visibility-real.json)：scenario=agent-high-risk-escalation-v1 |

## 效果指标

- 验收状态：passed=2, manual=2, failed=0, affected=0, unverified=0
- 检查状态：passed=3, failed=0, affected=0, other=0
- Finalization：6262 ms，9 次命令

### 评测组

| 组 | 场景 | 通过率 | 首次验收 | 输入 / 缓存 / 输出 Token | 耗时 |
|---|---|---:|---:|---:|---:|
| full | agent-high-risk-escalation-v1 | 100% | 100% | 43797 / 22016 / 676 | 35593 ms |
| bare | agent-high-risk-escalation-v1 | 0% | 0% | 36626 / 22016 / 432 | 29655 ms |
| without-risk-research | agent-high-risk-escalation-v1 | 0% | 0% | 44045 / 22016 / 599 | 33581 ms |

## 优化建议

- **保留 · 完整 OpenATDD**：相对 bare，完整策略的质量指标更高。
- **保留 · 按风险启用外部调研**：相对 without-risk-research，完整策略的质量指标更高。
- **保留 · 条件式 Agent 与独立审查**：本次未调用 Agent，条件式策略避免了不必要的多 Agent 成本。

## 解释边界

- 借鉴来源表示设计启发，不表示运行外部框架。
- 策略选择、实际调用和效果相关性分开展示；单次对照不能证明因果。
- 缺失数据保持不可用，不由模型猜测补全。

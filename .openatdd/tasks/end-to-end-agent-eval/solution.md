# 方案卡：end-to-end-agent-eval

<!-- openatdd:recommendation -->
## 推荐方案

在现有 Node.js `agent-eval` runner 上增加向后兼容的端到端 delivery 模式，不新建第二套评测平台。新模式将一句用户需求和完整种子项目交给 Codex，允许真实读写、执行项目命令和预验收；Agent 结束后再执行不可见的独立验收。每个简单、中等、复杂场景在相同模型配置下顺序运行 bare、thin-atdd 和 full-openatdd 三个 profile，输出同一结构的质量与成本报告。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 现有 runner 已有临时工作区、种子目录复制、argv-only 隐藏检查、Codex provider 与 Token 采集，新模式只扩展执行语义和报告字段。
- planning-only schema v1 保持原样；delivery schema v2 与新报告分支独立验证，避免让新实验破坏现有回归。
- bare 组只获得普通实现请求；thin 和 full 的 profile 内容独立指纹，不再把评分答案放进公共提示。
- 不引入数据库、服务器、队列、浏览器账号或新 npm 运行时依赖。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 扩展 Codex adapter：保留旧 planning 提示与 JSON schema；delivery 模式不泄露评分协议，保留工具权限，从 JSONL 采集用量、工具/命令和最终交付。
- 新增版本化 `thin-atdd` profile，只包含验收推导、技术方案检查点、实现、预验收与 UAT 交接；full profile 继续使用当前 Skill，并显式记录本地评测的自主继续授权。
- 增加通用 profile 组执行与 delivery 观测：工作区改动、隐藏功能通过、自验收命令、技术方案产物、就绪声明、错误就绪与 UAT 交接。
- 增加三个可独立复制的小型 Node.js 种子项目及工作区之外的隐藏验收命令。
- 增加一次 CLI 运行三 profile 的参数、真实报告验证与跨场景汇总命令，并补充 README 用法。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- **bare 被结果采集协议污染**：不要求模型输出路由、决策 ID 或预期架构；公共用户请求只补充正常的“完成后说明改动、验证和如何试用”。
- **full 流程在无人评测中停在确认门禁**：评测仅对本地临时项目给出明确实现授权，要求保留方案产物后自主继续；报告显示该授权。
- **评测器把模型自述当成通过**：功能通过只来自 Agent 结束后的工作区外隐藏检查；自述只用于判定就绪声明和交接可用性。
- **Codex JSONL 事件版本变化**：解析器对未知事件宽容，原始事件仅在显式调试时保留，且用 fixture 覆盖已知命令事件、无命令事件和 usage 缺失。
- **模型费用和时间不可控**：默认每 profile 两次且串行运行，超时与模型配置写入报告；fixture 先验证结构，真实运行不由项目检查重复触发。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不删除或重写现有 planning-only 场景与报告。
- 不用 lane 标签、工作流专有词或符合 OpenATDD 风格作为 delivery 质量分数。
- 不引入 LLM-as-judge；技术方案和 UAT 交接只做可机械验证的完整性观测，不冒充人的主观质量判断。
- 不部署生产环境，不访问外部付费数据或账号，不在种子项目中包含真实凭据。
- 不把两次运行的差异声称为统计显著或因果证据。
<!-- /openatdd:exclusions -->

## 实现细节

- `agent-eval.mjs` 支持 schema v1 planning 和 schema v2 delivery。delivery 分支接收通用 `profileAdapters` 数组，每个 profile 在新工作区重复执行，返回统一汇总。
- delivery 工作区在 Agent 前后计算相对路径与 SHA-256 快照，隐藏检查仍用 argv 数组且只在 Agent 退出后运行。
- `codex-agent-adapter.mjs` 保留 planning 的 output schema；delivery 只使用 `--json` 和 `--output-last-message`，从 JSONL 中归一化 usage 与命令执行，避免用结构化答案提示教会 bare 组 ATDD 行为。
- 公共请求只要求完成实现并简述改动、已运行验证和人如何试用。thin 额外注入有长度上限的独立 profile；full 额外注入当前 Skill 与本地授权。
- delivery 观测保存 `functionalPass`、`selfVerification`、`claimedReady`、`falseReady`、`technicalPlanPresent`、`handoffComplete`、`changedFiles`、隐藏检查以及 Token/耗时；任何通过结论均不依赖模型自述。
- 三个场景都使用无外部依赖的 Node.js 小项目：简单为局部功能，中等为现有模块组合与边界处理，复杂为多模块状态与安全不变量；用户需求给出完整产品决策，不依赖人工中途回复。

## 影响路径

- `skills/openatdd/scripts/agent-eval.mjs`
- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `evals/agent/profiles/`
- `evals/agent/scenarios/`
- `evals/agent/fixtures/`
- `evals/agent/rubrics/`
- `evals/reports/`
- `tests/agent-eval.test.mjs`
- `README.md`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | schema v2 delivery 场景和通用 profileAdapters 三组执行 | 三 profile 同配置、独立工作区与报告指纹测试 |
| AC-02 | delivery Codex 模式、可写种子项目与 Agent 后隐藏检查 | 先 Agent 后隐藏命令的进程顺序和实际代码改动 fixture |
| AC-03 | bare 仅接收普通用户实现请求 | 提示快照禁止 lane、决策 ID、隐藏关键词和预期方案 |
| AC-04 | 版本化 thin-atdd profile 与 SHA-256/长度报告 | profile 边界、指纹稳定和未注入完整 Skill 的回归 |
| AC-05 | delivery observation 与 false-ready 判定 | 真实通过、宣称通过但隐藏失败、未自验收及交接缺失 fixtures |
| AC-06 | 按场景/profile 的质量、成本和差异汇总 | 真实模型报告验证、小样本声明和汇总字段测试 |
| AC-07 | planning v1 兼容分支、CLI 新参数和 provider 配置复用 | 现有 agent eval 全回归、CLI help/进程测试和 `npm run check` |

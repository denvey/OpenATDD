# 验收卡：optimize-quick-delivery

## 目标

优化 Quick 小改动的检索、验证与最终化路径，避免无关读取、重复 dry-run、伪造 preflight 证据和已知失败的全量检查

## 建议用户旅程

1. Agent 将一个已知目标文件、可逆、低风险的小改动评估为 Quick。
2. Agent 只读取相关代码与规则，准备与当前验收标准匹配的最终化清单，并先做静态校验。
3. 对不依赖真实服务、账号或组织的组件级验证，清单显式声明项目级预检范围。
4. Agent 完成一次绿色 rehearsal 和一次正式最终化；超出默认工作预算时给出原因而不降低验证质量。

## 验收标准

### AC-01 [AUTO] [BLOCKING] Quick 指令采用最小默认工作预算
- 前提：任务位置已知、改动局部、模式成熟且可逆。
- 操作：Agent 按 OpenATDD Quick 指令执行检索、读取、修改和验证。
- 结果：默认只进行一次定位、一次目标批量读取、一个最小补丁、相关检查和一次差异检查；语义搜索、CodeGraph、无关架构资料、已知失败的全量检查和子代理仅在有明确理由时使用。
- 证据：Skill 与 README 的约束测试和文本检查。

### AC-02 [AUTO] [BLOCKING] 最终化清单可在执行前静态校验
- 前提：任务已有批准的验收与方案，且存在候选最终化清单。
- 操作：运行 `openatdd validate-finalization <task>`。
- 结果：命令在不执行 smoke、check、UAT、不写 preview 的情况下返回完整的 schema、验收映射与清单路径校验结果；无效清单返回非零状态。
- 证据：CLI 与 finalization 单元测试。

### AC-03 [AUTO] [BLOCKING] 任务级清单优先于项目级清单
- 前提：任务目录存在 `finalization.json`，项目根目录也存在旧任务清单。
- 操作：未显式传入 `--manifest` 时校验或最终化当前任务。
- 结果：OpenATDD 选择任务级清单；没有任务级清单时保持项目级回退，显式参数仍具有最高优先级。
- 证据：manifest 路径解析测试。

### AC-04 [AUTO] [BLOCKING] 组件级验证无需伪造运行环境证据
- 前提：清单显式声明 `preflight.scope: project` 并提供原因，环境档案仍包含角色、组织、集成或 fixture 信息。
- 操作：执行静态校验和最终化预检。
- 结果：工作区、项目和启动命令等项目事实仍被校验；服务、入口、登录、组织、集成、fixture 与 workaround 被标记为不适用且不要求 assertions/evidence；默认 `environment` 范围保持原有严格行为。
- 证据：manifest、profile preflight 与 finalization 回归测试。

## 边界

- 不自动忽略失败检查，不把非零退出码当作通过。
- 不允许项目级预检范围静默生效：必须显式配置并给出原因。
- 不自动把旧任务的 UAT 命令重映射到新验收标准。
- 默认预算是优化提示，不是牺牲风险覆盖的硬限制。

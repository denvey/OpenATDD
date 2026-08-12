# 验收卡：eval-user-config

## 目标

让真实 Codex Agent 评测默认沿用当前用户配置中的 provider 与对应额度，并把完全隔离改成显式选择，避免静默切换到另一份 ChatGPT 登录额度。

## 建议用户旅程

1. 用户以 `--adapter codex` 启动 Agent 评测。
2. OpenATDD 将同一配置模式传给主组、裸 Agent 基线组和所有能力消融组。
3. 子 Codex 进程默认加载用户级 `config.toml`；只有显式传入 `--isolated-config` 才忽略它。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 默认保留用户 provider
- Given: 用户级配置声明了自定义 provider，且评测使用 bundled Codex adapter。
- When: 用户不传配置模式选项。
- Then: 最终 `codex exec` 不包含 `--ignore-user-config`，由 Codex 标准配置加载机制选择 provider 与认证来源。
- Evidence: `tests/agent-eval.test.mjs` 的 argv 与配置模式断言。

### AC-02 [AUTO] [BLOCKING] 隔离配置必须显式选择
- Given: 用户需要排除全部用户配置以进行可复现评测。
- When: 用户传入 `--isolated-config`。
- Then: 主组、裸基线和消融组的 `codex exec` 都包含 `--ignore-user-config`，报告记录 `configMode: isolated`。
- Evidence: 适配器默认行为回归测试。

### AC-03 [AUTO] [BLOCKING] 对照组共享同一配置模式且报告可审计
- Given: 评测包含主组、裸 Agent 基线或能力消融组。
- When: 用户选择默认或隔离配置模式。
- Then: 所有 bundled Codex adapter 共享该选择，CLI 帮助展示 `--isolated-config`，报告 adapter 元数据记录 `user` 或 `isolated`，且不记录配置内容。
- Evidence: CLI 帮助检查、adapter 单元测试和聚焦 Agent eval 测试。

## 边界

- 不修改登录凭证、provider 配置或额度本身，不读取或记录 secret。
- 默认加载用户配置，但仍保留 `--ignore-rules`；需要完全隔离时由用户显式传入 `--isolated-config`。
- 不把用户配置内容复制进评测报告，只记录 `user` 或 `isolated` 模式。

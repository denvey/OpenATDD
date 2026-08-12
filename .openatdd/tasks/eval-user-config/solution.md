# 方案卡：eval-user-config

<!-- openatdd:recommendation -->
## 推荐方案

bundled Codex adapter 默认沿用 Codex 用户配置，并提供 `--isolated-config` 显式开关。默认不再传入 `--ignore-user-config`，避免自定义 provider 被替换成登录缓存对应的默认 provider。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 直接复用 Codex CLI 已有的配置加载语义，不解析、复制或暴露用户配置与凭证。
- 选项通过既有 `codexOptions` 同时传递到主组、裸基线和能力消融组，保持 A/B 公平。
- 完全隔离仍可显式启用，已有 CI 可通过固定 `--isolated-config` 保持可复现语义。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- `codex-agent-adapter.mjs` 仅在显式隔离时传入 `--ignore-user-config`。
- `agent-eval.mjs` 与主 CLI 接受并传播 `--isolated-config`。
- adapter 报告元数据记录 `configMode`，避免额度来源再次变成隐式事实。
- 增加默认隔离、显式加载和帮助文本的自动化测试。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 用户配置中的插件可能降低跨机器可复现性；需要严格隔离的 CI 显式使用 `--isolated-config`，报告同时记录 `configMode`。
- 主组与基线配置不一致会污染对照；通过共享同一个 `codexOptions` 值避免分叉。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不自动探测 App 当前账户，不同步登录状态，不修改 `~/.codex/config.toml` 或 `auth.json`。
- 不改变 mock/command adapter，也不让报告包含 provider URL、账户 ID 或凭证。
<!-- /openatdd:exclusions -->

## 实现细节

- `createCodexAdapter` 将隔离选项映射为适配器 argv，并把 `configMode` 传给通用 command adapter。
- bundled 子适配器只在启用隔离配置时添加 `--ignore-user-config`；`--ignore-rules` 保持不变，继续隔离仓库执行策略。
- 两个 CLI 入口均使用同名 flag，避免全局命令与脚本行为不一致。

## 影响路径

- `skills/openatdd/scripts/codex-agent-adapter.mjs`
- `skills/openatdd/scripts/agent-eval.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `tests/agent-eval.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 默认不添加 `--ignore-user-config` | 用户模式 argv 单元测试 |
| AC-02 | `--isolated-config` 贯穿 CLI 与 bundled adapter | 隔离模式回归测试 |
| AC-03 | 共用 `codexOptions`，报告记录 `configMode` | adapter 元数据与 CLI 帮助检查 |

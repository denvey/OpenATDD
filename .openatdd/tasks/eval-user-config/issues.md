# Issues: eval-user-config

## ISSUE-001 [resolved] AC-02

- Symptom: UAT 发现默认 --ignore-user-config 会丢失自定义 model_provider，却继续复用 ChatGPT 登录缓存，导致评测消耗错误账户额度。
- Root cause: 适配器默认传入 --ignore-user-config，导致 model_provider 与自定义 provider 定义被丢弃，但 ChatGPT 登录缓存仍可用，于是子进程静默切换到错误额度来源。
- Regression protection: bundled Codex argv 默认与显式隔离模式断言，并通过真实 adapter provider 探测。
- Invariant: 真实 Agent 评测默认沿用用户 provider；忽略用户配置必须由 --isolated-config 显式选择并记录到报告。
- Memory: INC-2026-012


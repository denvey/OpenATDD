# UAT 前报告：eval-user-config

## 从这里开始

- 版本：1.0.0
- 环境：local
- 角色：n/a
- 安全账户引用：n/a (no login required)
- 入口：打开 report.preview.md。
- 预计时间：5 分钟
- 验证 epoch：5

### 前置条件

- 启动或验证命令: npm run check

## 分步人工验收

请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。

### 第 1 步 — AC-01：默认保留用户 provider

- 前提：用户级配置声明了自定义 provider，且评测使用 bundled Codex adapter。
- 操作：用户不传配置模式选项。
- 预期结果：最终 `codex exec` 不包含 `--ignore-user-config`，由 Codex 标准配置加载机制选择 provider 与认证来源。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 2 步 — AC-02：隔离配置必须显式选择

- 前提：用户需要排除全部用户配置以进行可复现评测。
- 操作：用户传入 `--isolated-config`。
- 预期结果：主组、裸基线和消融组的 `codex exec` 都包含 `--ignore-user-config`，报告记录 `configMode: isolated`。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

### 第 3 步 — AC-03：对照组共享同一配置模式且报告可审计

- 前提：评测包含主组、裸 Agent 基线或能力消融组。
- 操作：用户选择默认或隔离配置模式。
- 预期结果：所有 bundled Codex adapter 共享该选择，CLI 帮助展示 `--isolated-config`，报告 adapter 元数据记录 `user` 或 `isolated`，且不记录配置内容。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：无独立证据文件；请判断上述可观察结果。

## 相关链接

- [详细 UAT 报告](report.preview.md)
- [已批准的验收卡](acceptance.md)
- [已批准的方案卡](solution.md)
- [问题与修复日志](issues.md)
- [local 环境档案](../../environments/local.yaml)
- [Finalization 清单](finalization.manifest.json)
- [项目文档](../../../README.md)

## 交付证据摘要

- 需求：Allow bundled Codex agent evaluations to opt into the current user config so configured providers and quotas are preserved.
- 阶段：PRE_UAT
- 验收批准时间：2026-07-28T02:53:58.943Z
- 方案批准时间：2026-07-28T02:53:58.998Z
- 就绪时间：尚未就绪

### 验收结果

| 验收 | 类型 | 阻塞 | 状态 | 证据 |
|---|---|---:|---|---|
| AC-01 | AUTO | 是 | affected | - |
| AC-02 | AUTO | 是 | affected | - |
| AC-03 | AUTO | 是 | affected | - |

### 项目检查

- Bundled Codex adapter configuration regressions [focused]：**affected** — `node --test tests/agent-eval.test.mjs` — 1898 ms
- Complete OpenATDD project checks [broad]：**affected** — `npm run check` — 7651 ms

### 修复

- ISSUE-001：适配器默认传入 --ignore-user-config，导致 model_provider 与自定义 provider 定义被丢弃，但 ChatGPT 登录缓存仍可用，于是子进程静默切换到错误额度来源。（INC-2026-012）

### 受影响的历史验收

- detailed-uat-handoff：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- fast-portable-finalization：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-1-0：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08
- openatdd-mvp：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09
- optimize-quick-delivery：AC-01, AC-02, AC-03, AC-04
- strategy-visibility：AC-01, AC-02, AC-03, AC-04

### 人工判断

没有剩余的人工验收项。

### 性能观察

- 环境预检：0 ms
- 预计浏览器往返：1
- ACCEPTANCE_DRAFT：134183 ms
- ACCEPTANCE_APPROVED：57 ms
- SOLUTION_DRAFT：2 ms
- CONTRACT_APPROVED：67 ms
- IMPLEMENTING：245219 ms
- PRE_UAT：11242 ms
- READY_FOR_UAT：45349 ms
- REPAIRING：83 ms
- ACCEPTANCE_DRAFT：118332 ms
- ACCEPTANCE_APPROVED：53 ms
- SOLUTION_DRAFT：2 ms
- CONTRACT_APPROVED：51 ms
- IMPLEMENTING：166139 ms

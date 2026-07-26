# 方案卡：optimize-quick-delivery

<!-- openatdd:recommendation -->
## 推荐方案

在现有 schema v1 上做向后兼容扩展：新增只读的 `validate-finalization` 命令、任务级清单默认优先级，以及显式的 `preflight.scope: project`。同时收紧 Quick 的提示约束，让已知目标的小改动走短路径，但所有质量门禁仍由清单和测试保持。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 `validateFinalizationManifest`、`loadFinalizationManifest`、`runEnvironmentPreflight` 和 CLI 分派，不增加新服务或状态文件。
- 新字段均为可选；旧清单默认继续使用严格的环境预检和项目级清单路径。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- `validate-finalization` 在运行任何命令或写 preview 前返回完整静态诊断。
- 默认清单解析顺序调整为显式参数 → 当前任务清单 → 项目清单。
- `preflight.scope: project` 显式跳过实时环境事实，并要求记录原因。
- Quick 指令增加默认工作预算、受限检索和失败基线处理规则。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 风险是项目级预检被滥用来绕过真实 UAT；通过显式 scope、必填 reason、默认严格行为和回归测试限制。
- 任务级清单可能意外遮蔽项目清单；通过确定的优先级、静态校验结果中的 resolved path 和显式参数最高优先级缓解。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不自动重写未知 AC，不自动选择测试命令，不接受已知失败检查，不合并 rehearsal 与正式最终化。
<!-- /openatdd:exclusions -->

## 实现细节

- `manifest.mjs` 验证 preflight scope/reason，并解析任务级清单。
- `profiles.mjs` 在 project scope 下保留项目身份检查，将 live checks 标记为 `not_applicable`。
- `finalization.mjs` 暴露静态检查入口，并将 scope/reason 传给 dry-run 与 formal preflight。
- `openatdd.mjs` 增加 CLI 命令和非零无效状态。

## 影响路径

- `skills/openatdd/scripts/manifest.mjs`
- `skills/openatdd/scripts/profiles.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/SKILL.md`
- `README.md`
- `tests/finalization.test.mjs`
- `tests/delivery-v2.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | Quick 指令和 README 默认预算 | Skill 文本与回归测试 |
| AC-02 | 静态校验函数与 CLI 命令 | CLI 不执行命令、不写 preview 的测试 |
| AC-03 | 清单解析优先级 | manifest 路径解析测试 |
| AC-04 | project-scope preflight | profile 与 finalization 测试 |

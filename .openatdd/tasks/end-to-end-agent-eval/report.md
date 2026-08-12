# UAT 前报告：end-to-end-agent-eval

## 从这里开始

- 版本：1.0.0
- 环境：local
- 角色：n/a
- 安全账户引用：n/a (no login required)
- 入口：打开 report.md。
- 预计时间：10 分钟
- 验证 epoch：2

### 前置条件

- 启动或验证命令: npm run check

## 分步人工验收

请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。

### 第 1 步 — AC-01：三种难度都执行公平的三组端到端对照

- 前提：存在简单、中等和复杂三个版本化场景，每个场景包含可独立复制的小型种子项目和面向用户的一句需求。
- 操作：分别对裸 Agent、精简 ATDD 核心和完整 OpenATDD 运行同一场景。
- 预期结果：三组使用相同模型、推理强度、用户配置、超时和重复次数，工作区彼此隔离；报告明确记录三种 profile 及场景难度。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 2 步 — AC-02：评测真实实现与预验收而非只输出计划

- 前提：三个种子项目都包含可观察的用户结果和仅评测器可见的功能检查。
- 操作：Agent 在可写工作区中读取、修改并验证代码，然后结束交付。
- 预期结果：Agent 可以正常使用工具和项目命令；隐藏检查只在 Agent 结束后运行，并从实际工作区判断功能是否完成。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 3 步 — AC-03：裸基线不再收到 OpenATDD 答案线索

- 前提：评测器需要为三组提供必要的运行与结果采集协议。
- 操作：构建裸 Agent 提示与隐藏验收。
- 预期结果：公共提示不包含 Quick / Standard / Deep、预期技术方案、决策 ID、隐藏检查关键词或 OpenATDD 特有步骤；裸组只依靠模型默认工程能力。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 4 步 — AC-04：精简 ATDD 核心是有界的可识别 profile

- 前提：需要测量验收优先核心能力，而不是再注入完整 529 行 Skill。
- 操作：运行精简 ATDD 组。
- 预期结果：精简 profile 只要求 AI 从用户需求推导验收结果、保留技术方案检查点、实现、执行预验收并准备人工 UAT；内容独立版本化且报告保存字节数与摘要指纹。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 5 步 — AC-05：报告区分真实成功、自验收和错误就绪声明

- 前提：Agent 可能运行检查、不运行检查，或在最终功能仍错误时宣称已完成。
- 操作：评测器采集 Agent 工具记录、最终交付和独立隐藏检查。
- 预期结果：每次运行至少记录功能通过、是否执行自验收、宣称就绪状态、错误就绪声明和交接可用性；不把模型自述当作功能通过证据。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 6 步 — AC-06：报告完整比较质量与成本

- 前提：同一场景的三个 profile 均完成指定次数的真实模型运行。
- 操作：生成并验证对照报告。
- 预期结果：报告按场景和 profile 列出功能通过率、错误就绪率、自验收率、交接可用性、总耗时、输入/缓存/非缓存/输出 Token 及组间差异，并明示样本数与模型配置。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-module-delivery-reports-module-simple-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-simple-report.md), [check-module-delivery-reports-module-medium-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-medium-report.md), [check-module-delivery-reports-module-complex-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-complex-report.md), [check-module-delivery-reports-module-summary-contract.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-summary-contract.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

### 第 7 步 — AC-07：新评测不破坏现有可重现能力

- 前提：项目已有 planning-only 场景、mock / command / Codex 适配器、报告验证和用户 provider 配置。
- 操作：增加端到端评测模式并运行项目检查。
- 预期结果：现有 schema v1 场景、CLI 用法和 mock 回归继续通过；三组仍共享用户 provider 或共同使用显式隔离配置，配置模式记录在报告中。
- 结论：[ ] Pass  [ ] Fail
- 判断方式：确认准备的证据与可观察结果。
- 已准备证据：[check-broad-project-broad-project-check.md](evidence/finalize/epoch-2/check-broad-project-broad-project-check.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

## 相关链接

- [详细 UAT 报告](report.md)
- [已批准的验收卡](acceptance.md)
- [已批准的方案卡](solution.md)
- [问题与修复日志](issues.md)
- [local 环境档案](../../environments/local.yaml)
- [Finalization 清单](finalization.manifest.json)
- [项目文档](../../../README.md)
- [AC-01 证据: check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md)
- [AC-01 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-01 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-01 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-01 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-02 证据: check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md)
- [AC-02 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-02 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-02 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-02 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-03 证据: check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md)
- [AC-03 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-03 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-03 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-03 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-04 证据: check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md)
- [AC-04 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-04 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-04 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-04 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-05 证据: check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md)
- [AC-05 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-05 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-05 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-05 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-06 证据: check-module-delivery-reports-module-simple-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-simple-report.md)
- [AC-06 证据: check-module-delivery-reports-module-medium-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-medium-report.md)
- [AC-06 证据: check-module-delivery-reports-module-complex-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-complex-report.md)
- [AC-06 证据: check-module-delivery-reports-module-summary-contract.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-summary-contract.md)
- [AC-06 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-06 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-06 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-06 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)
- [AC-07 证据: check-broad-project-broad-project-check.md](evidence/finalize/epoch-2/check-broad-project-broad-project-check.md)
- [AC-07 证据: batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md)
- [AC-07 证据: batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md)
- [AC-07 证据: batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md)
- [AC-07 证据: batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md)

## 交付证据摘要

- 需求：重新设计并运行简单、中等、复杂三类端到端 Agent 评测，对比裸 Agent、精简 ATDD 核心和完整 OpenATDD，衡量真实实现、AI 预验收质量、人工验收准备度、耗时与 token。
- 阶段：READY_FOR_UAT
- 验收批准时间：2026-07-28T16:13:16.402Z
- 方案批准时间：2026-07-28T16:31:08.549Z
- 就绪时间：2026-07-28T21:20:23.979Z

### 验收结果

| 验收 | 类型 | 阻塞 | 状态 | 证据 |
|---|---|---:|---|---|
| AC-01 | AUTO | 是 | passed | [check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-02 | AUTO | 是 | passed | [check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-03 | AUTO | 是 | passed | [check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-04 | AUTO | 是 | passed | [check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-05 | AUTO | 是 | passed | [check-focused-agent-eval-focused-agent-eval-tests.md](evidence/finalize/epoch-2/check-focused-agent-eval-focused-agent-eval-tests.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-06 | AUTO | 是 | passed | [check-module-delivery-reports-module-simple-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-simple-report.md), [check-module-delivery-reports-module-medium-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-medium-report.md), [check-module-delivery-reports-module-complex-report.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-complex-report.md), [check-module-delivery-reports-module-summary-contract.md](evidence/finalize/epoch-2/check-module-delivery-reports-module-summary-contract.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |
| AC-07 | AUTO | 是 | passed | [check-broad-project-broad-project-check.md](evidence/finalize/epoch-2/check-broad-project-broad-project-check.md), [batch-delivery-evaluation-journey-uat-simple-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-simple-report.md), [batch-delivery-evaluation-journey-uat-medium-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-medium-report.md), [batch-delivery-evaluation-journey-uat-complex-report.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-complex-report.md), [batch-delivery-evaluation-journey-uat-summary-contract.md](evidence/finalize/epoch-2/batch-delivery-evaluation-journey-uat-summary-contract.md) |

### 项目检查

- End-to-end Agent evaluation regressions [focused]：**passed** — `node --test tests/agent-eval.test.mjs` — 696 ms
- Real-model delivery report contracts and aggregate comparison [module]：**passed** — `node skills/openatdd/scripts/openatdd.mjs agent-eval --verify-report evals/reports/delivery-simple.json --min-runs 2 --require-profile bare --require-profile thin-atdd --require-profile full-openatdd && node skills/openatdd/scripts/openatdd.mjs agent-eval --verify-report evals/reports/delivery-medium.json --min-runs 2 --require-profile bare --require-profile thin-atdd --require-profile full-openatdd && node skills/openatdd/scripts/openatdd.mjs agent-eval --verify-report evals/reports/delivery-complex.json --min-runs 2 --require-profile bare --require-profile thin-atdd --require-profile full-openatdd && node --input-type=module --eval import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{summarizeDeliveryEvaluationReports}from'./skills/openatdd/scripts/agent-eval.mjs';const paths=['evals/reports/delivery-simple.json','evals/reports/delivery-medium.json','evals/reports/delivery-complex.json'];const computed=await summarizeDeliveryEvaluationReports(paths,{clock:()=>new Date('2026-07-29T00:00:00.000Z')});const persisted=JSON.parse(await readFile('evals/reports/delivery-summary.json','utf8'));for(const key of ['contracts','scenarios','totals','comparisons'])assert.deepEqual(persisted[key],computed[key]);assert.deepEqual(computed.scenarios.map(({difficulty})=>difficulty).sort(),['complex','medium','simple']);for(const name of ['bare','thin-atdd','full-openatdd']){assert.equal(computed.totals[name].runs,6);assert.equal(computed.totals[name].passedRuns,6)}for(const reportPath of paths){const report=JSON.parse(await readFile(reportPath,'utf8'));const configs=['bare','thin-atdd','full-openatdd'].map(name=>{const{model,reasoningEffort,configMode}=report.profiles[name].adapter;return{model,reasoningEffort,configMode}});assert.deepEqual(configs[1],configs[0]);assert.deepEqual(configs[2],configs[0])}console.log(JSON.stringify({status:'passed',scenarios:computed.scenarios.length,profiles:Object.keys(computed.totals)}));` — 123 ms
- Complete OpenATDD project checks [broad]：**passed** — `npm run check` — 3942 ms

### 修复

UAT 前未解决任何缺陷。

### 受影响的历史验收

- detailed-uat-handoff：AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07
- eval-user-config：AC-01, AC-02, AC-03
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
- ACCEPTANCE_DRAFT：570143 ms
- ACCEPTANCE_APPROVED：78 ms
- SOLUTION_DRAFT：1072069 ms
- CONTRACT_APPROVED：68 ms
- IMPLEMENTING：17350378 ms
- PRE_UAT：4984 ms

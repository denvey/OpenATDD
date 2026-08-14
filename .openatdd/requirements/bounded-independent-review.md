# 需求交付：bounded-independent-review

<!-- openatdd:delivery -->
## 状态与合并建议

- 状态：已验收
- 合并建议：可以合并

## 交付结论

自动验证已完成，验证 epoch 为 2。

## 人工验收入口

本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。

## Reviewer 重点

- 范围漂移：无计划外变更
- 未完成检查：无
- 回滚：还原下方实际变更文件，并删除本需求的 Git 私有运行目录。

## 实际变更与验收摘要

- M README.md
- M skills/openatdd/SKILL.md
- M skills/openatdd/references/governance.md
- M skills/openatdd/scripts/openatdd.mjs
- M skills/openatdd/scripts/workflow.mjs
- M tests/intelligence-integration.test.mjs
- M tests/intelligence.test.mjs

| 验收 | 类型 | 状态 | 结果摘要 |
|---|---|---|---|
| AC-01 | AUTO | passed | Finalization manifest for AC-01 verified this automatic criterion. |
| AC-02 | AUTO | passed | Finalization manifest for AC-02 verified this automatic criterion. |
| AC-03 | AUTO | passed | Finalization manifest for AC-03 verified this automatic criterion. |
| AC-04 | AUTO | passed | Finalization manifest for AC-04 verified this automatic criterion. |
| AC-05 | AUTO | passed | Finalization manifest for AC-05 verified this automatic criterion. |
| AC-06 | AUTO | passed | Finalization manifest for AC-06 verified this automatic criterion. |
<!-- /openatdd:delivery -->

<!-- openatdd:acceptance -->
# 验收卡：bounded-independent-review

## 目标

让独立方案审查保持有效但有明确止损：正常审查有足够时间发现问题，Reviewer 执行异常不会无限重派，同一方案不会重复消耗时间，预算耗尽后按风险进入可追溯的降级或人工决策。

## 建议用户旅程

1. Deep 任务完成方案后，主 Agent 为当前方案登记一次独立审查，并获得机器返回的轮次、尝试编号和超时时间。
2. Reviewer 在预算内返回 PASS 或带明确问题的 FAIL；后者属于有效审查，方案修订后只进行一次定向复审。
3. Reviewer 超时、无响应或无法启动时，系统记录执行异常，并且最多允许更换 Reviewer 重试一次。
4. 相同方案摘要、同一轮次超过允许次数时，CLI 直接拒绝新的派发。
5. 预算耗尽后，普通 Deep 允许明确降级为主 Agent 审查；含危险授权风险的 Deep 要求人工决定，不得伪造独立通过。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 首次审查与定向复审使用固定预算
- 前提：Deep 任务存在可校验的当前方案摘要。
- 操作：分别登记首次独立审查和方案修订后的定向复审。
- 结果：首次审查返回 900000ms 硬预算；定向复审返回 300000ms 硬预算，终态记录绑定对应方案摘要。
- 证据：workflow 单元测试与 CLI JSON 输出断言。

### AC-02 [AUTO] [BLOCKING] 同一方案的执行异常最多重试一次
- 前提：某轮独立审查因超时、无响应、进程未挂载或其他运行异常未产生可用判定。
- 操作：为相同方案摘要重新登记 Reviewer。
- 结果：第一次异常后允许第二个全新 Reviewer；第二次异常后禁止第三次派发，并记录预算耗尽状态。
- 证据：相同 fingerprint 的 planned/running/blocked 状态机回归测试。

### AC-03 [AUTO] [BLOCKING] 有效 FAIL 不会被误判为执行失败
- 前提：Reviewer 在预算内完成审查并返回明确阻塞问题。
- 操作：先将 Agent 执行记录为 passed，再将方案审查结果记录为 failed。
- 结果：系统要求修订方案而不是重试相同审查；新方案只允许一次 recheck 轮次。
- 证据：独立 dispatch 与 solution review 组合测试。

### AC-04 [AUTO] [BLOCKING] 重复派发和超时通过被机器拒绝
- 前提：同一方案已有成功 Reviewer、已用尽尝试，或 Reviewer 的 passed 结果超过该轮预算。
- 操作：再次登记新 dispatch 或尝试记录 passed。
- 结果：CLI 返回稳定错误码，不写入伪造的成功记录，也不允许相同 fingerprint 无限重派。
- 证据：重复、超预算、错误轮次负向测试。

### AC-05 [AUTO] [BLOCKING] 预算耗尽后按风险明确降级
- 前提：同一轮两次 Reviewer 执行均失败。
- 操作：普通 Deep 与含危险授权 overlay 的 Deep 分别尝试由主 Agent 记录方案通过。
- 结果：普通 Deep 可在状态明确标记 independent unavailable 后由主 Agent审查；危险 Deep 拒绝静默降级并要求人工决定。
- 证据：无风险与授权风险两类 approve-solution 门禁测试。

### AC-06 [AUTO] [BLOCKING] 工作流文档与可见交付说明一致
- 前提：维护者阅读 Skill、governance 和 README。
- 操作：检查独立审查链路、时间预算、FAIL 语义、重试次数和降级规则。
- 结果：三处描述与代码常量一致，不再只有“bounded”或“十分钟异常”这样的软约定。
- 证据：文档契约测试和最终 diff 检查。

## 边界

- 本次控制 OpenATDD 的审查 dispatch 记录和方案审批门禁；宿主仍负责按返回的 timeout 实际终止 Agent。
- 不增加常驻调度服务、数据库或第三次人工确认。
- 不把 Reviewer 返回明确问题视为失败；只有未返回可用判定才消耗运行异常重试。
- 不改变 Quick 默认无 Agent、Standard 独立审查可选的现有行为。
<!-- /openatdd:acceptance -->

<!-- openatdd:solution -->
# 方案卡：bounded-independent-review

<!-- openatdd:recommendation -->
## 推荐方案

在现有 `agent-dispatch` 状态机中增加独立审查专用预算元数据和派发门禁。OpenATDD 为每次合法派发返回必须由宿主执行的 timeout；终态按实际 `durationMs` 校验。相同方案摘要按 `initial` 和 `recheck` 两轮计数，每轮最多两次执行尝试，已有可用判定或预算耗尽后拒绝继续派发。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 复用现有 Git 私有 state、solution fingerprint、Agent runtime attestation 和 CLI，不引入调度服务。
- 同时约束调度前、状态更新和方案审批，无法靠上层 Agent 忽略文档继续重试。
- 保持 Reviewer 只读、Sol High/xHigh 分层路由和当前方案完整性门禁不变。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 新增独立审查常量、round/attempt/fingerprint/budget 计算与验证。
- `agent-dispatch` 为 independent-review 返回 `reviewControl`，并拒绝重复、超次数和超预算 PASS。
- 独立方案审查只能引用当前 fingerprint 下可用的 passed dispatch。
- 两次运行异常后记录 `unavailable`；普通 Deep 可显式 main fallback，高风险 Deep 保持阻塞。
- 增加 CLI 参数、状态摘要、测试与文档说明。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- CLI 不能直接终止宿主 Agent；通过返回强制 timeout、校验终态耗时并拒绝非法 PASS 形成双端约束。
- 方案内容变化会产生新 fingerprint；只允许在已有有效 FAIL 后进入 recheck，避免随意改空格绕过去重。
- fallback 不能伪装成独立审查，状态和 review reviewer 均保持真实。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不实现后台队列或跨进程 kill 服务。
- 不增加第三次人工审批。
- 不降低危险操作的授权和独立审查要求。
<!-- /openatdd:exclusions -->

## 实现细节

- `initial`：900000ms；只有 current fingerprint 尚无历史有效判定时可用。
- `recheck`：300000ms；要求旧 fingerprint 存在有效 failed review，且当前 fingerprint 已变化。
- 每个 round/fingerprint 最多两个不同 dispatch；第一次执行异常后才能创建第二个。
- `passed` dispatch 超预算被拒绝；blocked/failed 表示运行异常并消耗 attempt；Reviewer 有结论时 dispatch 为 passed，再通过 `review-solution` 记录 PASS/FAIL。
- 两次异常后 `reviewControl.status=unavailable`。无授权风险时允许显式 main fallback；危险 Deep 必须保持阻塞并请求人工决策。

## 影响路径

- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `skills/openatdd/SKILL.md`
- `skills/openatdd/references/governance.md`
- `README.md`
- `tests/intelligence-integration.test.mjs`
- `tests/intelligence.test.mjs`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | round-aware timeout 常量和 reviewControl | 首次/recheck CLI 与单元测试 |
| AC-02 | fingerprint+round attempt 门禁 | 两次异常与第三次拒绝测试 |
| AC-03 | dispatch 成功与 review verdict 分离 | failed review 后 recheck 测试 |
| AC-04 | duplicate/over-budget guard | 稳定错误码负向测试 |
| AC-05 | unavailable 与风险感知 fallback | 普通/危险 Deep 审批测试 |
| AC-06 | Skill/governance/README 同步 | 文档契约与 diff 检查 |
<!-- /openatdd:solution -->

<!-- openatdd:details -->
## 追溯说明

此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。
<!-- /openatdd:details -->

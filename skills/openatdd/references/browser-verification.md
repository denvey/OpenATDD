# Browser verification routing

Read this reference only for Web or mixed-surface pre-UAT.

Choose the executor for the approved observation and total journey latency:

1. **deterministic** — a stable Playwright or project browser command runs with
   no model. This is the default when a command-backed journey exists.
2. **browser-low** — a dynamic page uses a clean-context browser executor following
   the kernel's Terra 6.1 / xhigh preference when the host tool supports it, unless
   the user specifies otherwise. This existing mode name does not require low
   reasoning. Keep the read-only filesystem, browser-only capability, and one
   reused browser session. Receive approved steps, assertions, environment details,
   and current page state; implementation claims are not proof. This executor
   performs the journey, records observations against each criterion, and escalates
   failures or uncertainty without changing code, contracts, or the final verdict.
3. **human** — subjective visual quality remains a final human judgment.

When the same model implemented the UI, use a clean verification context rather
than its implementation conversation; no different model is required. Objective
layout defects can be checked against explicit criteria. Read DOM facts and
network results where available; a success screenshot alone does not prove a
business operation persisted. Separate API assertions run through existing API
tests or command adapters, not expanded browser-only permissions. The controller
checks coverage and actual evidence without repeating a successful journey solely
to perform it personally. Coverage gaps, failures, and changed candidates still
require verification under the existing epoch rules.

Lower model price does not by itself lower input Token. Reduce Token by batching
actions, reusing one session, extracting only named DOM facts, and taking
screenshots only at checkpoints or failure.
Execute the approved batches autonomously without a controller round trip for
every click; external-action authorization still applies.

Before browser work, require passing preflight and a validated UAT plan. Use up
to three cohesive batches where practical: setup/entry/login, primary journey,
and final readback/evidence. Each step has one action and an expected result.
The batch command or executor itself must perform the observable journey; a
manual journey cannot be relabeled as formal JSON evidence afterward.

Select an executor when generating the plan:

```bash
openatdd plan-uat TASK --execution-mode deterministic
openatdd plan-uat TASK --execution-mode browser-low
openatdd plan-uat TASK --execution-mode human
```

Narrow a failed batch only for diagnosis. After repair, advance the epoch and
rerun every batch. Keep credentials in `.env.openatdd.local`; never persist
account values, personal data, or unsafe payloads in screenshots or logs.

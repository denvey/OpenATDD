# Browser verification routing

Read this reference only for Web or mixed-surface pre-UAT.

Use the cheapest executor that can deterministically observe the approved
result:

1. **deterministic** — a stable Playwright or project browser command runs with
   no model. This is the default when a command-backed journey exists.
2. **browser-low** — a dynamic page uses a clean-context `gpt-5.6-luna` browser
   executor with low reasoning, read-only filesystem, browser-only capability,
   and one reused session. It receives only the approved steps, assertions, and
   current page summary. It makes no product or architecture decisions and
   escalates failure or uncertainty to the main Agent.
3. **human** — subjective visual quality remains a final human judgment.

Lower model price does not by itself lower input Token. Reduce Token by batching
actions, reusing one session, extracting only named DOM facts, and taking
screenshots only at checkpoints or failure.

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

# Solution card: portable fast finalization

## Implementation

- Add a versioned project contract at `.openatdd/finalization.json` and resolve
  it into a task-local `finalization.json`. Use strict JSON with argv arrays,
  project-relative working directories, named environment-variable references,
  timeouts, source include/exclude rules, dry-run commands, grouped final checks,
  UAT batches, acceptance-to-evidence mappings, history policy, and budgets.
  Validate the complete manifest before executing anything; never pass commands
  through a shell.
- Add `openatdd finalize <task> --dry-run [--manifest <path>]`. It computes a
  candidate fingerprint, runs configured smoke/entry-point commands with
  redacted captured output, invokes environment preflight in non-persisting
  mode, validates UAT coverage, builds a preview handoff/report with pure
  renderers, scans secrets, resolves every local path against the preview report
  directory, and checks applicable HTTP(S) links. It writes only
  `finalize-preview.json` and `report.preview.md`; approved state, epochs,
  formal results, history tasks, READY, and notifications remain unchanged.
- Compute fingerprints with Node crypto over a sorted stream of normalized
  relative path, file mode, size, and content digest. Discover tracked,
  modified, ignored-status, and untracked candidates with `git ls-files`, with
  a deterministic filesystem fallback. Always exclude `.git`, local credential
  files, dependency/build caches, transaction staging, reports, previews, and
  task evidence; merge project exclusions with manifest rules. Include the
  manifest and non-secret environment profile. Recompute before execution,
  before commit, and at readiness; a mismatch stops the run.
- Add `openatdd finalize <task> [--manifest <path>]` as the normal fast path.
  Require a green preview with matching manifest/profile/source digests, create
  one new clean verification boundary in a draft state, execute preflight,
  focused/module/broad groups, and UAT batches exactly once into a staging
  evidence directory, map their captured evidence to every acceptance ID,
  scan all staged output, prepare the handoff, and validate readiness entirely
  before committing passed state.
- Refactor the existing preflight, plan, result, check, batch, handoff, and
  readiness logic into reusable validation/pure-mutation helpers. Keep current
  public functions and granular CLI commands as wrappers so manual/debug flows
  and schema-v1/v2 tasks keep working. Add an optional `finalization` block to
  schema-v2 state rather than forcing a global state-version migration; tasks
  enter the optimized contract only when a manifest is resolved.
- Implement a recoverable multi-file commit in the finalizer: stage all task
  artifacts and projected current/historical states, record a transaction
  journal with before/after digests, commit historical projections first and
  the current READY state last, and recover or roll back an interrupted journal
  on the next OpenATDD command. A command, evidence, validation, fingerprint, or
  commit failure leaves no partially passed current finalization.
- On every successful finalization, store a secret-free
  `finalization-snapshot.json` containing the replayable command contract,
  acceptance mapping, contract hashes, and evidence rules. At later shared
  changes, keep the existing early `affected` marking but defer execution.
  Finalization replays affected snapshots once after the final fingerprint is
  green, or requires explicit manifest overrides for legacy tasks without a
  snapshot. Cache results by historical task, approved-contract digest,
  manifest digest, and final source fingerprint; verify cached evidence before
  reuse and invalidate on any key change.
- Store a single `finalize-result.json` with wall time, command/CLI invocations,
  dry-run/final run counts, check-group runs, UAT batches, browser round trips,
  history runs/cache hits, evidence writes, per-phase durations, source and
  manifest digests, plus non-blocking budget warnings. Enforce one broad group,
  one complete UAT journey, and one affected-history pass per successful final
  fingerprint; repeated `finalize` on an unchanged completed fingerprint is an
  idempotent cache hit.
- Make the fast path the default procedure in `SKILL.md`: focused repair only
  before rehearsal, one dry-run, freeze, one finalize, then human UAT. Move the
  manifest schema, examples, surface-specific adapters, diagnostics, and
  fallback commands into a concise `references/fast-finalization.md`. Update
  `agents/openai.yaml`, README, version/package metadata, and installation
  guidance so copied, npm-linked, and symlinked installations behave the same.
- Add real-process and fixture coverage for CLI/API/Web/mixed manifests,
  dry-run non-mutation, CLI option wiring, report/link resolution, secrets,
  complete fingerprints including untracked files, mid-run changes, command
  failure, atomic rollback/recovery, same-fingerprint idempotence, repair
  routing, replay snapshots, legacy overrides, history deduplication, metrics,
  budgets, schema-v1/v2 compatibility, and the copied standalone Skill.

## Impact paths

- `skills/openatdd/SKILL.md`
- `skills/openatdd/agents/openai.yaml`
- `skills/openatdd/references/verification-routing.md`
- `skills/openatdd/references/fast-finalization.md`
- `skills/openatdd/scripts/lib.mjs`
- `skills/openatdd/scripts/profiles.mjs`
- `skills/openatdd/scripts/manifest.mjs`
- `skills/openatdd/scripts/finalization.mjs`
- `skills/openatdd/scripts/workflow.mjs`
- `skills/openatdd/scripts/openatdd.mjs`
- `tests`
- `evals`
- `README.md`
- `package.json`
- `.gitignore`
- `.openatdd`

## Acceptance trace

| Acceptance | Implementation | Verification |
|---|---|---|
| AC-01 | Strict reusable project manifest, resolved task snapshot, argv-only runner, and copied/npm/symlink portability | CLI/API/Web/mixed clean-project schemas and real-process installation fixtures |
| AC-02 | Non-persisting preflight, staged command logs, pure preview handoff/report, secret scan, and task-relative/HTTP link checks | Prior CLI-wiring and report-link regressions plus environment, secret, coverage, successful-preview, and state-diff tests |
| AC-03 | Git-aware deterministic file inventory, fallback walker, normalized content fingerprint, exclusions, and repeated mutation guards | Tracked/untracked/mode/path-order/exclusion/mid-run/unchanged/credential fingerprint tests |
| AC-04 | One finalize orchestrator, staged evidence, pure state projections, journaled multi-file commit, and current state committed last | Happy path, invalid manifest, failed command, rollback, crash recovery, retry, and granular-command equivalence tests |
| AC-05 | Pre-freeze preview diagnostics separated from post-freeze issue/epoch rules | Pre-freeze retries, post-freeze issue resolution, stale evidence, and one complete new final run |
| AC-06 | Replayable finalization snapshots, legacy overrides, fingerprint-keyed cache, and batched final history commit | No-early-rerun, one final replay, cache hit, invalidation, legacy blocking, and current-readiness dependency tests |
| AC-07 | Finalization counters, per-phase timing, repetition invariants, idempotent unchanged finalize, and budget warnings | Counter/deduplication/retry/budget evaluations comparing granular and bulk execution |
| AC-08 | Optional additive state block, wrapper-compatible granular commands, concise Skill reference, metadata/docs, and package versioning | v1/v2 migration, old command regression, official Skill validation, package dry-run, and dev/regression/holdout corpus |

## Risks

- Project commands can mutate external systems. Require argv-only commands,
  project-contained working directories, validated local/staging environment
  profiles, explicit applicability, and existing authorization; dry-run never
  implies production safety.
- A process crash can occur between multiple historical state renames. Use a
  write-ahead transaction journal with before/after digests and automatic
  recovery, and commit the current READY state last.
- A broad default fingerprint can include unrelated user changes, while a
  narrow one can miss dependencies. Default to all non-ignored project files,
  expose explicit exclusions with diagnostics, and record the exact inventory
  digest in every final result.
- Legacy tasks do not have replay snapshots. Block automatic history completion
  until a task-specific override maps commands/evidence to every affected ID;
  never mark all historical criteria passed from one unmapped broad command.
- Command output can contain credentials. Redact loaded values before display or
  persistence, scan staged artifacts before commit, and delete rejected staging
  from formal evidence routing.

## Deliberate exclusions

- Do not guarantee a universal wall-clock duration or terminate a valid slow
  project solely for exceeding a budget.
- Do not weaken broad checks, complete UAT, historical acceptance, fresh
  evidence, repair memory, or human judgment to reduce time.
- Do not build a general CI service, dashboard, distributed job runner,
  container sandbox, universal browser framework, or mandatory subagent system.
- Do not infer safe production commands, log into unknown systems, or execute
  shell strings from manifests.
- Do not remove existing granular commands or require old schema-v1/v2 tasks to
  migrate before they can be inspected, repaired, or completed manually.
- Do not deploy, send notifications, commit, push, or mutate production data.

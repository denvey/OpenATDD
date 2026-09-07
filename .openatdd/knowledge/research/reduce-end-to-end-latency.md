# Research: reduce-end-to-end-latency

Date: 2026-08-19

## Relevant external findings

- Node.js documents `performance.now()` as a high-resolution monotonic timer relative to the current process time origin. OpenATDD commands are separate CLI processes, so persisted workflow-stage timing should continue to use stored wall-clock timestamps; in-process command metrics may use a monotonic timer without becoming the persisted cross-process source of truth.
  - Source: https://nodejs.org/api/perf_hooks.html#performancenow
- Git worktrees share repository data while keeping separate working trees and indexes. This supports retaining isolated writable Worker worktrees instead of introducing shared-checkout writes as a latency shortcut.
  - Source: https://git-scm.com/docs/git-worktree

## Project-specific conclusion

The latency fix should reuse the existing persisted timestamps, finalization metrics, execution-plan contracts, and isolated-worktree orchestration. No timing daemon, database, shared writable checkout, or proprietary host call belongs in the core.

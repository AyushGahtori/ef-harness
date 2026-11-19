# M0 Exit Certification

- Pass count: 10000/10000
- Failed runs: 0
- Lost-work violations: 0
- Duplicated-work violations: 0
- Double-spent or budget violations: 0
- Rollup drift violations: 0
- DB write latency p50: 0.137 ms
- DB write latency p95: 2.655 ms
- DB write latency p99: 6.212 ms
- Seed 42 trace SHA-256: 060bdf40f91db93cf7e1e0c9786cf9efde398f56318bf66b9563be2f1fe1a8ea
- Seed 1337 trace SHA-256: 29906ff794207b6594f40166267c0ede12e8651bf27d0f63f9bb362073a87897

## Fault classes exercised

| Fault | Fires |
| --- | ---: |
| before_begin_immediate | 1250 |
| after_write_before_commit | 1250 |
| after_commit_before_ipc_receipt | 1250 |
| after_issue_grant_before_deposit | 1250 |
| after_close_grant_before_broker_ack | 1250 |
| after_outbox_append_before_delivered_at | 1250 |
| during_cas_temp_rename | 1250 |
| during_sleep_jump | 1250 |

## Sign-off

M1 UNLOCKED. The M0 kernel skeleton passed 10,000/10,000 crash-injected deterministic runs with zero lost work, zero duplicated work, zero double-spent budget, and zero rollup drift.

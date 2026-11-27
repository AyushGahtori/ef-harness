# M1 Exit Report

This report keeps the deterministic CI run on `FakeModelAdapter` separate from live LLM certification. Scripted CI acceptance is not the live-model exit bar.

## Deterministic CI

- Acceptance: 20/20 on scripted trajectories
- Stub block rate: 100% (10/10 rejected, 0 accepted)
- Red-team escapes: 0/7 on the kernel policy tier
- Average verification duration: 125 ms on the seeded CI clock (25 ms per bound check)
- Token receipt: 2760 in, 920 out
- Cost receipt: 345 micro-USD scripted ledger units. This is not a provider charge.
- M2 unlock: these scripted receipts, with a 100% stub block and 0 red-team escapes, plus the frozen 20-task Kitchen benchmark, are the assets that unlock M2. They are not a live-model sign-off.
- Hint-ladder failure then fix: K01, K03
- Static-audit rejection then fix: K08
- Red-before-green on the unmodified seed: 20/20 tasks failed every bound check before a worker ran
- Already-green fixture caught: yes
- Identical CI replay: yes
- Repeated identical hidden fingerprint: ladder step 3, escalated yes
- Dev server: served on env-k15.localhost, died on destroy yes
- Viewer: opened yes, diff hunk yes, receipt pass
- Vault canary occurrences in prompts, receipts, CAS, and Git objects: 0
- Leftovers: processes 0, port leases 0, temp dirs 0, rollup drift 0, outbox without deliveries 0
- Kitchen seed source bytes: 2336

## Live LLM certification

- Status: not run
- Claimed M1 live bar (>= 17/20): no
- Reason: CI mode uses FakeModelAdapter. Live certification is a separate --live run and was not executed.

## OS sandbox

- Kernel policy blocks: 7/7
- OS sign-off: withheld. Tier C stays advisory on this host, so this run does not claim OS enforcement.
- Tier C: Tier C advisory: network and profile-read probes are not OS-enforced on this machine. Full red-team sign-off requires Tier A, B, or D.
- Tier C reported as OS-enforced: no

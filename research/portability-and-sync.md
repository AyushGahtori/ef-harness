# Research: moving project knowledge between machines and sharing capacity

Question: how can a local SQLite-backed project travel with its Git repository, support a second device or teammate, and how should several projects share one plan and one laptop? Design: [projects, portability and sync](../projects-portability-and-sync.md).

## Carrying state in Git

| Option | Pros | Cons |
|---|---|---|
| Commit the SQLite file | Simple | Binary, not mergeable, bloats history |
| `.harness/` folder in the product tree | Visible in reviews | Clutters product history and PRs |
| **Orphan branch** with text files | Travels with any clone and remote; no shared history with product code; diffable | One more branch to explain |
| Git notes | Attached to commits | Awkward for a whole knowledge base |
| Sync service (Litestream to object storage) | Continuous | Needs cloud storage; outside Git |

An orphan branch has no parent commits (`git switch --orphan`), so it shares nothing with product branches. [git-switch](https://git-scm.com/docs/git-switch) · [Litestream](https://litestream.io/)

**One file per entity** with sorted keys keeps diffs readable and lets changes to different entities merge without conflict.

**Encrypting held-back checks** with a simple file-encryption tool such as age keeps them unreadable on clones while the rest stays reviewable. [age](https://age-encryption.org/)

## Single writer across devices

- Git rejects non-fast-forward pushes by default, which gives a compare-and-swap on the state branch: the device whose lease is stale can't overwrite a takeover. `--force-with-lease` is the explicit form of the same idea. [git-push](https://git-scm.com/docs/git-push)
- Lease with epoch (fencing token) is the standard pattern for preventing a paused or partitioned old writer from corrupting state (Kleppmann, *Designing Data-Intensive Applications*, “fencing tokens”).

## Multi-writer alternatives considered

CRDT-based SQLite replication (e.g. cr-sqlite) and document CRDTs (Automerge) allow concurrent writers to merge automatically, but add complexity to every write and don't resolve *semantic* conflicts such as two different cutoff times. Deferred beyond v1. [cr-sqlite](https://github.com/vlcn-io/cr-sqlite) · [Automerge](https://automerge.org/)

## Sharing capacity between projects

- **Weighted fair queuing / deficit round robin** gives each class a share proportional to its weight without starving low-weight classes (Shreedhar and Varghese, 1995).
- Reserving capacity for interactive work is a common scheduler practice (e.g. separate interactive and batch queues in operating systems and cluster schedulers).
- Hierarchical token buckets (a parent budget split into child grants) avoid cross-database transactions: the broker grants, projects spend within grants.

## To measure

- Time to rehydrate a large project from the state branch.
- Interactive reply latency in project B while project A runs 6 workers on the same plan.

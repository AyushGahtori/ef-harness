# Research: the assembly line from spec to merged app

Question: what established practices support staged planning, just-in-time detail, serialized merging and branch freshness at the scale of many parallel workers? Design: [build pipeline](../build-pipeline.md).

## Decide at the last responsible moment

Lean software development recommends delaying decisions until the last responsible moment, when not deciding would remove an option, while making early the decisions that are hard to reverse (Poppendieck and Poppendieck, *Lean Software Development*, 2003). The upfront/just-in-time rule applies this: cross-boundary and hard-to-reverse items upfront, feature-internal detail one wave ahead.

## Keep the trunk green

- **The “not rocket science” rule:** automatically maintain a repository of code that always passes all tests, by testing each change on top of the current trunk before merging (Graydon Hoare, describing Rust's bors bot, 2014). [Blog post](https://graydon2.dreamwidth.org/1597.html)
- **Merge queues** (e.g. GitHub merge queue) implement the same rule at scale. [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- `git update-ref <ref> <new> <old>` updates a ref only if it still has the expected old value, an atomic compare-and-swap. [git-update-ref](https://git-scm.com/docs/git-update-ref)
- `git merge-tree --write-tree` computes a merge result and conflicts without touching any worktree. [git-merge-tree](https://git-scm.com/docs/git-merge-tree)

## Short-lived branches

Trunk-based development keeps feature branches short-lived (hours to a couple of days) to avoid painful merges, which is why waves are sized in hours and branches are synced only when needed. [Trunk-based development](https://trunkbaseddevelopment.com/)

## Migration naming

Timestamp-based migration names (as in Rails since 2.1) avoid collisions between branches that both add “the next” migration. [Rails migrations](https://guides.rubyonrails.org/active_record_migrations.html)

## Contracts between parallel teams

Consumer-driven contracts let producers and consumers develop in parallel against an agreed interface, and classify changes as compatible or breaking. [Pact](https://docs.pact.io/) · [Semantic Versioning](https://semver.org/)

## Cost of repeated context

Providers discount cached input tokens when a prompt's prefix repeats, so putting stable instructions first and task data last reduces cost. [OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching) · [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

## To measure

- Paperwork share of total cost on the benchmark projects (target ≤ 20%, typical 8–15%).
- Merge-queue wait time and conflict rate as waves grow.
- Rework caused by just-in-time documents versus upfront documents.

# Research: running test backing services on Windows without Docker

Question: how can a desktop harness provide Postgres, Redis, mail, OAuth and payment fakes to many parallel test environments on Windows, quickly and without leftovers? Design: [test environments](../test-environments.md).

## Postgres

- `embedded-postgres` runs native Postgres binaries as a child process, with Windows x64 builds; it needs its post-install step (to be approved in pnpm). [embedded-postgres](https://www.npmjs.com/package/embedded-postgres) · [Windows binaries](https://www.npmjs.com/package/@embedded-postgres/windows-x64)
- PGlite is Postgres compiled to WebAssembly, in-process, but single-connection; multiple clients go through a multiplexer that “not all use cases are guaranteed” to work with. Suitable for unit-level checks, not app servers with connection pools. [PGlite](https://github.com/electric-sql/pglite/) · [PGlite socket](https://pglite.dev/docs/pglite-socket)
- `CREATE DATABASE … TEMPLATE` clones a database; the template must have no active connections. `STRATEGY FILE_COPY` with PostgreSQL 18's `file_copy_method = clone` gives near-instant copy-on-write clones, but only on file systems with reflink support (XFS, ZFS, APFS, Btrfs). On Windows, small templates are the practical path. [CREATE DATABASE](https://www.postgresql.org/docs/current/sql-createdatabase.html) · [Instant clones](https://boringsql.com/posts/instant-database-clones/)

## Redis-compatible servers

- Neither Redis nor Valkey ships native Windows builds; the Valkey maintainers point to Docker and WSL2. [Valkey issue #92](https://github.com/valkey-io/valkey/issues/92)
- Memurai is a native Windows Redis port with a free developer edition; `redis-memory-server` switched to Memurai on Windows. [Memurai and Windows options](https://chat2db.ai/resources/blog/memurai-redis-on-windows-guide) · [redis-memory-server changelog](https://raw.githubusercontent.com/mhassan1/redis-memory-server/27fafd99543438f449f1faf086b8f285614136c2/CHANGELOG.md)
- Microsoft's Garnet is a Redis-protocol cache server built on .NET that runs on Windows; command coverage must be checked per app. [Garnet](https://microsoft.github.io/garnet/)

## Other fakes

| Need | Tool |
|---|---|
| Mail capture | [Mailpit](https://mailpit.axllent.org/) (single binary, search API) |
| OAuth / OIDC | [oauth2-mock-server](https://github.com/axa-group/oauth2-mock-server) (Node) |
| Stripe API shape | [stripe-mock](https://github.com/stripe/stripe-mock) |
| Record and replay of HTTP | [Polly.js](https://netflix.github.io/pollyjs/) |
| Fake data | [Faker](https://fakerjs.dev/) with a fixed seed |

## Isolation facts

- Cookies don't isolate by port: “cookies for a given host are shared across all the ports on that host.” [RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)
- Names under `.localhost` are reserved for loopback. [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)
- Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminate every process in the job when its last handle closes, including when the owner crashes. [Job object limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)

## To measure

- Template clone time on NTFS and Dev Drive for functional and performance seeds.
- Memory per environment with shared versus per-environment servers.
- Orphan processes after killing the daemon mid-run (target zero).

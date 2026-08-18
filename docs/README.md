# grannydb design docs

This app runs a small database out of a git repository, with no server anywhere. That constraint
forces a handful of decisions that turn out to be miniature versions of things you meet at much
larger scale: an operation log, a merge policy, snapshot isolation, a materialised view, a data
contract at the pipeline boundary.

These docs explain how it works and — more usefully — *why it is built the way it is*. Each page
names the general pattern behind the specific choice, so the thing you learn here transfers.

## Reading order

| # | Page | What it covers |
|---|------|----------------|
| 1 | [Overview](01-overview.md) | The problem, the hard constraints, and the shape of the answer |
| 2 | [Data model](02-data-model.md) | Why CSV, the three tables, schema-as-data, and how schema changes are absorbed |
| 3 | [Storage layer](03-storage-layer.md) | GitHub as a database: reads, the commit protocol, concurrency control |
| 4 | [Sync engine](04-sync-engine.md) | The operation log, replay, merge semantics, failure modes |
| 5 | [App architecture](05-app-architecture.md) | Module boundaries, extension points, routing, UI conventions |
| 6 | [Operations](06-operations.md) | Deploy pipeline, CI validation, tokens, security posture |

Decision records live in [`adr/`](adr/). Each one states what was chosen, what else was considered,
and what it costs. Start there when you want to know why something *is not* built some other way.

[`CHANGELOG.md`](CHANGELOG.md) records what changed and when.

## Concept map

If you already know these ideas from data engineering, here is where each one shows up:

| Concept | Where it lives here |
|---|---|
| Write-ahead log / event sourcing | The pending-change queue — [sync engine](04-sync-engine.md) |
| Log replay onto a new base | `syncChanges` retry loop — [sync engine](04-sync-engine.md) |
| CQRS (separate read and write models) | `merge.ts` produces the read model — [app architecture](05-app-architecture.md) |
| Materialised view | `data/bundle.json`, rebuilt by the pipeline — [operations](06-operations.md) |
| Snapshot isolation | All reads pinned to one commit sha — [storage layer](03-storage-layer.md) |
| Optimistic concurrency control | Fast-forward-only ref update — [storage layer](03-storage-layer.md) |
| Last-writer-wins register (CRDT) | Field-level merge in the queue — [sync engine](04-sync-engine.md) |
| Content-addressed immutable cache | Blob cache keyed by commit sha — [storage layer](03-storage-layer.md) |
| Data contract test | `scripts/build-data.ts` failing CI — [operations](06-operations.md) |
| Schema-on-read vs schema-on-write | CSV plus a validating pipeline — [data model](02-data-model.md) |
| Forward/backward schema compatibility | Unknown-column preservation — [data model](02-data-model.md) |

## Keeping these current

**Updating the docs is part of finishing a change, not a follow-up task.** The rule lives in
[`../CLAUDE.md`](../CLAUDE.md) so it survives across sessions:

> Any change to the data schema, storage or sync behaviour, module boundaries, or the deploy
> pipeline must update the relevant page here in the same change, add a `CHANGELOG.md` entry, and
> add an ADR if a real alternative was weighed and rejected.

Docs that describe an aspirational system are worse than no docs. If a page cites a file path,
field name or function that no longer exists, that is a bug.

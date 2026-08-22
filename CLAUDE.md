# grannydb — working notes for Claude

A serverless granny square tracker that runs a database out of this repo. Static site on GitHub
Pages; the browser reads and writes `data/*.csv` directly through `api.github.com`.

**Read [`docs/`](docs/) before changing anything structural.** Start with
[`docs/README.md`](docs/README.md); [`docs/adr/`](docs/adr/) records what was already considered and
rejected.

## The rule about documentation

> Any change to the data schema, storage or sync behaviour, module boundaries, or the deploy
> pipeline must update the relevant page in `docs/` **in the same change**, add a
> `docs/CHANGELOG.md` entry, and add an ADR under `docs/adr/` if a real alternative was weighed and
> rejected.

This is not optional polish. The owner is using this project to learn how these patterns work, so
the docs are a deliverable, not a description of one. Docs that describe an aspirational system are
worse than no docs — if a page cites a file, field or function that no longer exists, that is a bug.

Docs are written to name the general pattern behind each specific choice (write-ahead log, CQRS,
snapshot isolation, optimistic concurrency, materialised view, data contract). Keep that register:
explain *why*, not just *what*, and say what a decision costs as well as what it buys.

## Invariants — do not break these

1. **`src/core/` imports no React.** `scripts/build-data.ts` runs it in Node, so CI and the app
   enforce identical rules. It is also why the logic is unit-testable.
2. **The CSV writer preserves unknown columns and rows.** Hand-editing in a spreadsheet is a primary
   use case. Never drop a column the schema does not mention.
3. **The change queue stores field-level operations, never whole files or whole rows.** This is what
   makes concurrent edits merge instead of clobbering. See
   [ADR 0004](docs/adr/0004-operation-log-not-file-snapshots.md).
4. **Reads are pinned to one commit sha; writes are fast-forward-only.** Do not "fix" a
   `StaleHeadError` by forcing the ref — re-read and replay.
5. **Nothing hardcodes owner/repo/branch/path.** Defaults live only in `DEFAULT_CONFIG`
   ([`src/core/github/config.ts`](src/core/github/config.ts)).
6. **No third-party runtime scripts, no CDN, no remote fonts.** A GitHub token lives in
   `localStorage` on an origin shared with every other project page under `anhtr.github.io`.
7. **Ids are never reused.** `nextId` takes max + 1 across existing ids, not a row count.

## Adding things

| Task | What to do |
|---|---|
| Add a field | Add a CSV column and an entry in `data/schema/<table>.json`. No code. |
| Add a table | Add `data/<t>.csv`, `data/schema/<t>.json`, and `<t>` to `tables.json`. Routes and nav are generic. |
| Add a field type | A case in `src/core/schema/validate.ts` and an entry in `src/ui/fields.tsx`. |
| Add a screen | An entry in `FIXED_ROUTES` in `src/app/App.tsx`. |

## Commands

```bash
npm run dev            # http://localhost:5173/grannydb/
npm test               # vitest
npm run typecheck
npm run build          # validates data, then builds
npm run validate-data  # data contract check only, seconds
```

Note that `npm run dev` with a token in Settings writes to the **real repo**. Point Settings →
Branch at a scratch branch when experimenting.

## Commits

One commit per numbered ask or GitHub issue, even when several land in the same conversation or
message. Don't bundle unrelated asks into one commit just because they were requested together.

## Style

Match the surrounding code. Comments explain *why* a non-obvious choice was made, not what the line
does — the existing comments are the reference for density and register. British spelling in user-
facing copy ("colour").

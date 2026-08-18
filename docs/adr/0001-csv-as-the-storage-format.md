# ADR 0001 — CSV as the storage format

**Status:** accepted · 2026-08-17

## Context

The data has to live in the repo, stay readable and editable by a human, and diff cleanly in git.
Roughly 400 square records plus two small lookup tables. It must be usable even if the app stops
working entirely.

## Options

**CSV, one file per table.** GitHub renders it as a sortable table in the web UI. A one-square edit
is a one-line diff. Opens in any spreadsheet. Weak on multi-valued fields and needs disciplined
quoting.

**JSON, one file per table.** Native nesting and arrays, so `extra_yarns` is just a list. But
github.com shows raw text, diffs carry brace and indentation noise, and hand-editing is easy to
break with a trailing comma.

**YAML.** Nicer to read than JSON, still not rendered as a table, and whitespace-sensitive editing
on a phone is unforgiving.

**One file per square** (Markdown with front-matter, or JSON). Perfect diff isolation, no write
contention between squares. But 400 files to browse, and any aggregate view means fetching all of
them.

**SQLite in the repo.** Real queries and constraints. Binary, so diffs are meaningless and git
history stops being useful — which defeats the point of putting it in a repo.

## Decision

CSV, one file per table.

The requirement that decided it: GitHub renders CSV *as a table*, so the raw data is browsable on a
phone with no app at all. That is the strongest possible guarantee against the app becoming a
gatekeeper for the data.

Multi-valued fields are handled with a `;`-delimited list in a single cell
([ADR 0004](0004-operation-log-not-file-snapshots.md) is unrelated; see the data model doc for the
join-table alternative).

## Consequences

- Three writer rules are non-negotiable: a real parser, deterministic minimal quoting, stable row
  and column ordering. Anything less produces whole-file diffs or corrupts notes fields.
- The writer must preserve unknown columns, which is what makes hand-editing safe.
- CSV cannot enforce anything, so validation moves to the build pipeline
  ([ADR 0009](0009-validate-in-the-build-pipeline.md)).
- Whole files are read and written every time. Fine at 400 rows; would not be at 400,000.
- Multi-valued fields are denormalised. Migrating to a join table is a field-type change, not an
  app change.

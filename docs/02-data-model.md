# 2. Data model

## Why CSV

The requirement was that the data stay readable and editable by a human, in the repo. That rules
out SQLite (binary, unreviewable diffs) and pushes toward a text format. Among text formats:

| Format | Renders on github.com | Diff quality | Multi-value fields | Hand-editing |
|---|---|---|---|---|
| **CSV** | as a sortable table | excellent, one row per line | awkward | spreadsheet or text editor |
| JSON | as raw text | noisy: braces, indentation | native | fiddly, easy to break |
| YAML | as raw text | good | native | whitespace-sensitive |
| One file per square | n/a | perfect isolation | native | 400 files to browse |

CSV wins on the two things that matter most here: GitHub renders it as a *table*, and a one-square
edit is a one-line diff. The cost is multi-valued fields, handled below. See
[ADR 0001](adr/0001-csv-as-the-storage-format.md).

### The rules that make CSV safe

CSV has no standard, and a sloppy writer will destroy data or produce 400-line diffs. Three rules,
all enforced in [`src/core/csv/`](../src/core/csv/) and covered by tests:

1. **Parse with a real parser, and pin the delimiter.** `split(',')` corrupts any notes field
   containing a comma, a quote, or a newline, so we use PapaParse. Its delimiter auto-detection is
   explicitly disabled: it guesses from character frequency, and `extra_yarns` is a
   semicolon-delimited list, so a file with enough multi-colour squares looks more
   semicolon-delimited than comma-delimited and gets parsed completely wrong. Auto-detection also
   fails outright on a single-column file. Both cases are pinned by tests.
2. **Deterministic minimal quoting.** Quote only values containing `,`, `"`, a newline, or leading
   or trailing whitespace — always the same way. An inconsistent writer turns every save into a
   whole-file diff.
3. **Stable ordering.** Rows sorted by id, columns in file order, LF endings, exactly one trailing
   newline. A new square lands in a predictable place instead of at the bottom.

### Round-trip safety

This is the property that makes hand-editing genuinely safe, and it is worth stating precisely:

> The writer preserves columns and rows it does not understand.

`parseCsv` keeps the header exactly as it appeared. `serializeCsv` writes those columns back in
that order. If you add a `hook_size` column in a spreadsheet and commit it, then edit an unrelated
square in the app, `hook_size` survives untouched — the app has never heard of it and does not need
to.

This is the same problem Avro and Protobuf solve with reader/writer schemas and field numbers:
**forward and backward compatibility**, so an old reader tolerates new fields and a new reader
tolerates old data. Here it falls out of "keep the header, never drop a column".

The test that pins it is `preserves a column the app knows nothing about` in
[`src/core/__tests__/csv.test.ts`](../src/core/__tests__/csv.test.ts).

## The tables

Four, in [`data/`](../data/). Small enough that the app loads all of them and works in memory.
`sources` is `hideFromNav`: it exists to be pointed at by `designs.source`, not browsed on its own —
see [ADR 0012](adr/0012-hidden-tables-for-lookup-only-data.md).

### `squares.csv`

| Column | Type | Notes |
|---|---|---|
| `id` | id | `S001`… Assigned, never reused |
| `date` | date | When it was made |
| `status` | enum | `planned` / `in progress` / `done` / `blocked` |
| `design_id` | ref → designs | |
| `customization` | textarea | How you deviated from the pattern |
| `main_yarn` | ref → yarns | |
| `extra_yarns` | reflist → yarns | `;`-separated, order preserved |
| `position` | text | Free text for now — the layout is undecided |
| `notes` | textarea | |

`blocked` is a `status` value, not a separate field: it is the stage *after* `done` (crocheted, then
also blocked), so a blocked square is still counted as finished toward the goal. It used to be an
independent boolean that could combine with any status; that let a square be `planned` and `blocked`
at once, which never meant anything. Folding it into `status` also removed `frogged` — a status for a
square that was pulled back out, which turned out to never get used since a frogged square is simply
deleted rather than tracked as a state.

### `yarns.csv`

| Column | Type | Notes |
|---|---|---|
| `id` | id | `Y01`… |
| `display_name` | text | Your own nickname. `titleField` — this is what "colour" means everywhere else in the app |
| `name` | text | Colourway, usually the manufacturer's name for the shade |
| `product_line` | text | The manufacturer's yarn line (e.g. "Scheepjes Chunky Monkey") rather than the manufacturer alone — that is the level yarn is actually bought and matched at |
| `product_id` | text | Manufacturer's shade or product code, kept separate so it can drive a reorder link later without overloading a free-text field |
| `hex` | color | Drives every colour swatch in the app, which is what makes a list of 400 squares scannable on a phone |
| `skeins` | number | |
| `partial_skein` | bool | At least one skein on hand has been started |
| `notes` | textarea | |

`display_name` is `titleField`; `name` is not. When `display_name` is blank — the common case right
after a bulk colour import, before anything has been hand-named — the app shows
`titleFallback: "{product_id} ({name})"` instead of falling back to the bare id. See
[ADR 0013](adr/0013-title-fallback-template.md).

### `designs.csv`

`id`, `name`, `source` (ref → sources), `notes`.

`source` used to be free text, retyped for every design that shared a book or website. It is now a
`ref` with `quickCreate`, the same pattern `squares.design_id` uses
([ADR 0010](adr/0010-quick-create-instead-of-folding-designs.md)): picking an existing source is a
`<select>`, and typing a new one only sets its name — its `type`/`url`/`note` are filled in later by
opening the source itself (tap the chip; `sources` has no nav tab of its own, see below). The old
`source_url` field is gone — a source's URL now lives on the source, once, instead of being retyped
per design that cites it.

### `sources.csv`

| Column | Type | Notes |
|---|---|---|
| `id` | id | `SRC01`… |
| `name` | text | |
| `type` | enum | `book` / `website` |
| `url` | url | |
| `note` | textarea | |

## Two modelling decisions worth explaining

### Extra colours in one cell, not a join table

`extra_yarns` holds `Y03;Y11;Y07` in a single cell. A normaliser's instinct is a `square_yarns`
join table with a `sequence` column, and that would be the right call if we needed per-colour
metadata ("this colour, rounds 4–6").

We do not, yet. What the single cell buys:

- one file open to see everything about a square
- an editable cell in a spreadsheet instead of rows in a second file to keep in step
- no orphan rows to clean up when a square is deleted
- order is still preserved, because a delimited list is ordered

What it costs: no per-colour attributes, and "which squares use Sage?" is a substring-ish scan
rather than a join. At 400 rows that is free.

The migration path is real, not hypothetical: `reflist` is a *field type*, so moving to a join table
means adding a `jointable` type to the schema layer and the field registry. Nothing else in the app
knows how extra colours are stored.

### Ids are permanent and never reused

`nextId` scans every existing id and takes max + 1, rather than counting rows. Delete `S003` and the
next square is `S006`, not `S003`. Ids appear in notes, in commit history, and eventually on
physical sticky notes; reuse would silently repoint old references at a different square.

## The schema is data

The single most important structural decision. Each table has a JSON file in
[`data/schema/`](../data/schema/) describing its fields:

```json
{ "key": "status", "label": "Status", "type": "enum",
  "options": ["planned", "in progress", "done", "frogged"],
  "default": "done", "list": true, "filter": true }
```

That one object produces: a labelled `<select>` on the edit form, a badge in the list view, a filter
dropdown, and a validation rule rejecting anything not in `options`. There is no `Status` component
anywhere in the codebase.

The schema files are fetched **at runtime**, alongside the CSVs, not compiled into the bundle. So:

> **Adding a field is a data change, not a deploy.** Add a column to the CSV, add a field to the
> JSON, commit both. The form, the list, the filters and the validation all pick it up.

See [ADR 0005](adr/0005-schema-as-data.md).

### Field types

`id`, `text`, `textarea`, `number`, `date`, `bool`, `enum`, `ref`, `reflist`, `color`, `url`.

A type is defined in two halves, deliberately split:

- **[`src/core/schema/validate.ts`](../src/core/schema/validate.ts)** — parsing and validation, pure
  TypeScript. This half has to run in Node during the build.
- **[`src/ui/fields.tsx`](../src/ui/fields.tsx)** — the `Input` and `Display` components.

Adding `image` later is one entry in each. Nothing else changes.

A `ref` field can also set `"quickCreate": true`, which adds a "+ New &lt;thing&gt;" affordance to
the field's picker that creates a row in the target table — setting only its title field — without
leaving the current form. `squares.design_id` and `designs.source` both use it: most squares turn out
to be a one-off design, and most designs cite a source already on file, so a separate "new X" screen
for every one was pure friction. See
[ADR 0010](adr/0010-quick-create-instead-of-folding-designs.md).

A `ref`/`reflist` field is edited through a live-search combobox, not a bare `<select>` — practical
once a table has more than a handful of rows, e.g. one design per square. `"searchFields"` on the
field names which fields on the *referenced* row the search matches against (`squares.design_id` sets
`["name", "source"]`, so picking a design searches by book as well as by name); omit it to search
every field on the referenced row. See
[ADR 0014](adr/0014-live-search-combobox-for-every-ref-field.md).

Three more knobs live on the *table*, not a field:

- `titleFallback` — a template like `"{product_id} ({name})"`, shown when `titleField` is blank
  instead of the bare row id, resolved by `titleFor()` in `core/schema/types.ts`. See
  [ADR 0013](adr/0013-title-fallback-template.md).
- `hideFromNav` — keeps a table out of the bottom nav while leaving it fully addressable, for a table
  like `sources` that exists to be pointed at by a `ref` field rather than browsed on its own. See
  [ADR 0012](adr/0012-hidden-tables-for-lookup-only-data.md).
- `searchFields` — which of *this* table's own fields the list's search box matches against.
  `designs.json` sets `["name"]`, so searching the Designs list matches the design's name and not the
  source it resolves through; omit it to search every field, right for a table with few enough fields
  that "search everything" is the honest default.

A field can also set `"sortable": true` to appear as a sort option in that table's list, alongside the
built-in sort by id and by title (`designs.source` uses it — see the sort control in
[app-architecture](05-app-architecture.md#the-generic-crud-components)). And a table can set
`"derivedFilters"` — filters computed by hopping through a `ref` field to a field on the table it
points at, for filtering by something the table does not store directly. `squares.json` filters by
`source` this way, hopping `design_id` to the design's `source`, since a square does not store a
source itself. See [ADR 0015](adr/0015-derived-filters-instead-of-a-materialised-column.md).

## Schema evolution policy

**Additive by default.** Adding a field is always safe: the writer appends the column, existing rows
get an empty value, and validation only complains if you mark it `required`.

**Renaming a field is a two-step.** The app matches on the column key. Rename in one commit and old
data silently reads as blank. Instead: add the new column, copy the values (a spreadsheet or a
throwaway script is fine), then remove the old one in a later commit.

**Removing a field is safe but not destructive.** Delete it from the JSON and the app stops showing
it — but the CSV column survives, because the writer preserves unknown columns. You have to remove
the column from the CSV separately. That asymmetry is deliberate: it means a schema mistake never
costs data.

**Changing a type is checked at the boundary.** Narrow `text` to `enum` and the next build fails,
naming every row that does not fit. Which brings us to the last point.

## Schema-on-read, enforced on write

CSV is a schema-on-read format: the file cannot reject a bad row, so nothing stops a hand-edit from
introducing a status of `dune` or a `main_yarn` pointing at a yarn that does not exist.

So enforcement moves to the pipeline. `validateDataset` runs in two places — in the app before a
sync, and in [`scripts/build-data.ts`](../scripts/build-data.ts) during the build, where it fails
CI. Same function, same rules, so the app's beliefs and CI's enforcement cannot drift apart. That is
a **data contract test** at the boundary where data enters the system.

Details in [operations](06-operations.md).

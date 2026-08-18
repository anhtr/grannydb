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

Three, in [`data/`](../data/). Small enough that the app loads all of them and works in memory.

### `squares.csv`

| Column | Type | Notes |
|---|---|---|
| `id` | id | `S001`… Assigned, never reused |
| `date` | date | When it was made |
| `status` | enum | `planned` / `in progress` / `done` / `frogged` |
| `blocked` | bool | Separate from status: a done square may still need blocking |
| `design_id` | ref → designs | |
| `customization` | textarea | How you deviated from the pattern |
| `main_yarn` | ref → yarns | |
| `extra_yarns` | reflist → yarns | `;`-separated, order preserved |
| `position` | text | Free text for now — the layout is undecided |
| `notes` | textarea | |

### `yarns.csv`

`id`, `name` (colourway), `brand`, `hex`, `skeins`, `notes`. The `hex` drives every colour swatch
in the app, which is what makes a list of 400 squares scannable on a phone.

### `designs.csv`

`id`, `name`, `source`, `source_url`, `notes`.

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

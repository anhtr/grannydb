# ADR 0005 — The schema is data in the repo, loaded at runtime

**Status:** accepted · 2026-08-17

## Context

A stated requirement: the schema will keep changing for years. Adding a field must not mean editing
several components, and ideally must not mean a deploy.

## Options

**TypeScript types plus hand-written forms.** Full type safety and complete freedom per screen.
Adding a field means touching the type, the form, the list, the filters and the validator — five
places, every time, forever.

**TypeScript schema objects driving generic components.** One place to edit, still type-safe, still
needs a rebuild and deploy for every field.

**JSON schema files in the repo, fetched at runtime.** One place to edit, no deploy, and the schema
sits next to the data it describes so they are reviewed in the same diff. Costs static type safety
over field keys: the app handles `Record<string, string>` rows and validates dynamically.

## Decision

JSON in [`data/schema/`](../../data/schema/), fetched at runtime alongside the CSVs.

A field entry drives the form control, the list column, the filter dropdown and the validation rule.
Field *types* are the extension point, split in two: validation in `core/schema/validate.ts` (must
run in Node during the build) and rendering in `ui/fields.tsx`.

## Consequences

- Adding a field is a data change: a CSV column and a JSON entry, committed together. No code, no
  deploy.
- Adding a whole table gives you a nav tab, list, detail, editor and validation for free — routes
  are resolved generically from the manifest.
- Rows are `Record<string, string>`; there is no `Square` interface. Correctness comes from runtime
  validation and tests rather than the compiler. Accepted deliberately: the alternative is a
  compile-time guarantee that has to be rewritten every time the schema moves.
- The schema files are themselves validated on load (`buildSchemaSet`), including cross-table checks
  that a `refTable` exists — a malformed schema fails loudly rather than rendering a broken form.
- Schema and data can disagree, e.g. a column present in one and not the other. Handled by the
  writer preserving unknown columns and the pipeline validating both.

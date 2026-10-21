import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { CsvRow } from '../core/csv'
import { compareIds } from '../core/csv'
import type { FieldDef, FieldType, TableSchema } from '../core/schema'
import {
  fieldByKey,
  formatBool,
  joinList,
  matchesSearch,
  parseBool,
  refDisplayLabel,
  searchText,
  splitList,
  titleFor,
  validateValue,
  changeStatus,
  fillStatusDates,
  statusDateIssues,
} from '../core/schema'
import { appStore } from '../core/store'
import { useLookup, useRefIds, useResolveRef, useTableSchema, useToday } from '../app/hooks'
import { Button, FieldShell, inputClass, Link, Swatch } from './components'

/**
 * The field-type registry.
 *
 * This is the app's main extension point. A schema field says `"type": "date"`; this table decides
 * what that means on screen. Adding `image` later is one entry here plus one entry in the schema
 * layer's validator, with nothing else touched.
 *
 * Parsing and validation deliberately live in `core/schema` instead: that half has to run in Node
 * during the build, where React does not exist.
 */

export interface FieldInputProps {
  field: FieldDef
  value: string
  onChange: (value: string) => void
  id: string
  /** The whole row being edited, and its schema — only `colorlist`'s pattern-aware preview uses these. */
  row?: CsvRow
  schema?: TableSchema
}

export interface FieldDisplayProps {
  field: FieldDef
  value: string
  /** The whole row being shown, and its schema — only `colorlist`'s pattern-aware swatch uses these. */
  row?: CsvRow
  schema?: TableSchema
}

interface FieldRenderer {
  Input: (props: FieldInputProps) => ReactNode
  Display: (props: FieldDisplayProps) => ReactNode
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>
}

/** Resolve a referenced row to something displayable: its title, and a swatch if it has one. */
function useRefInfo(refTable: string | undefined) {
  const schema = useTableSchema(refTable ?? '')
  const lookup = useLookup(refTable ?? '')
  return (id: string): { label: string; hex?: string; pattern?: string; missing: boolean } => {
    if (!schema) return { label: id, missing: false }
    const row = lookup.get(id)
    if (!row) return { label: id, missing: id !== '' }
    return {
      label: titleFor(schema, row),
      hex: schema.swatchField ? row[schema.swatchField] : undefined,
      pattern: schema.patternField ? row[schema.patternField] : undefined,
      missing: false,
    }
  }
}

/**
 * A reference shown as a chip. Links through to the referenced record's detail page — the only way
 * to reach a table that is `hideFromNav` (e.g. `sources`), short of typing the URL.
 */
function RefChip({ id, refTable }: { id: string; refTable?: string }) {
  const info = useRefInfo(refTable)(id)
  const content = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-sm ${
        info.missing ? 'text-red-600 dark:text-red-400' : ''
      }`}
    >
      {info.hex !== undefined ? <Swatch hex={info.hex} pattern={info.pattern} size={14} /> : null}
      {info.label}
      {info.missing ? ' (missing)' : ''}
    </span>
  )
  if (info.missing || !refTable) return content
  return <Link to={`/${refTable}/${id}`}>{content}</Link>
}

/**
 * The small annotation line a `ref` field's `detailFields` adds under its chip on the detail page —
 * e.g. a design's source and construction, so that context is visible without opening the design
 * itself. Renders nothing while the referenced row is missing or every named field is blank, rather
 * than a line of empty labels.
 */
function RefDetailFields({ id, refTable, keys }: { id: string; refTable: string; keys: string[] }) {
  const schema = useTableSchema(refTable)
  const lookup = useLookup(refTable)
  const resolve = useResolveRef()
  if (!schema) return null
  const row = lookup.get(id)
  if (!row) return null
  const parts = keys
    .map((key) => fieldByKey(schema, key))
    .filter((f): f is FieldDef => f !== undefined)
    .map((f) => ({ label: f.label, value: refDisplayLabel(f, row[f.key] ?? '', resolve) }))
    .filter((p) => p.value !== '')
  if (parts.length === 0) return null
  return (
    <p className="mt-0.5 text-xs text-muted">{parts.map((p) => `${p.label}: ${p.value}`).join(' · ')}</p>
  )
}

/**
 * How an inline quick-create tells the form around it that it holds a half-made row, so the form's
 * unsaved-changes guard covers that draft as well as the record's own fields. Each draft reports under
 * its own key: `true` while it has edits, `false` once they are added, cancelled or unmounted.
 */
export const DraftReporterContext = createContext<((key: string, dirty: boolean) => void) | null>(null)

/** Every field of a quick-create target except its id, which is assigned on save, not typed. */
function quickCreateFields(fields: FieldDef[], idField: string): FieldDef[] {
  return fields.filter((f) => f.key !== idField)
}

function initialQuickCreateDraft(schema: TableSchema, fields: FieldDef[], todayDate: string): CsvRow {
  const draft: CsvRow = {}
  for (const field of fields) {
    draft[field.key] = field.type === 'date' && field.defaultToday ? todayDate : (field.default ?? '')
  }
  return fillStatusDates(schema, draft, todayDate)
}

/**
 * "+ New <thing>" inline on a `ref` field, for a target table where most rows are one-offs. Opens a
 * full mini-form — every field on the target row, rendered with the same field renderers the main
 * record form uses — rather than asking only for the title and deferring the rest to a second visit.
 * A `ref` field inside that mini-form (e.g. a design's `source`) gets its own nested "+ New", one
 * level deep, for the same reason. See ADR 0018.
 */
function QuickCreate({ refTable, onCreated }: { refTable: string; onCreated: (id: string) => void }) {
  const schema = useTableSchema(refTable)
  const refIds = useRefIds()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CsvRow>({})
  const [opened, setOpened] = useState<CsvRow>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const todayDate = useToday()
  const reportDraft = useContext(DraftReporterContext)
  const draftKey = useId()

  const fields = schema ? quickCreateFields(schema.fields, schema.idField) : []
  const dirty = open && fields.some((f) => (draft[f.key] ?? '') !== (opened[f.key] ?? ''))
  useEffect(() => {
    reportDraft?.(draftKey, dirty)
    return () => reportDraft?.(draftKey, false)
  }, [reportDraft, draftKey, dirty])

  if (!schema) return null

  // The same status-date behaviour as the full form (`RecordForm`), so a quick-created row obeys the
  // rules it will be validated against.
  const setField = (key: string, value: string) => {
    const statusDates = schema.statusDates
    const isStatus = statusDates !== undefined && key === statusDates.field
    const touched = isStatus ? [key, ...Object.values(statusDates.dates)] : [key]
    setDraft((prev) => (isStatus ? changeStatus(schema, prev, value, todayDate) : { ...prev, [key]: value }))
    setErrors((prev) => {
      if (!touched.some((k) => prev[k])) return prev
      const next = { ...prev }
      for (const k of touched) delete next[k]
      return next
    })
  }

  const create = async () => {
    if (saving) return
    const found: Record<string, string> = {}
    for (const field of fields) {
      const message = validateValue(field, draft[field.key] ?? '', field.refTable ? refIds[field.refTable] : undefined)
      if (message) found[field.key] = message
    }
    for (const { field, message } of statusDateIssues(schema, draft)) found[field] ??= message
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      const newId = appStore.nextIdFor(refTable)
      await appStore.save(refTable, newId, draft)
      onCreated(newId)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-accent underline-offset-2 hover:underline"
        onClick={() => {
          const fresh = initialQuickCreateDraft(schema, fields, todayDate)
          setDraft(fresh)
          setOpened(fresh)
          setErrors({})
          setOpen(true)
        }}
      >
        + New {schema.labelSingular.toLowerCase()}
      </button>
    )
  }

  return (
    <div
      className="space-y-2 rounded-xl border border-line bg-paper p-2"
      // This sits inside the record's own form, so Enter in one of its boxes would save the record
      // and drop the half-made design. Here it adds the new row instead; a picker that has already
      // used the key for itself (see `RefSearchSelect`) has prevented the default and is left alone.
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.defaultPrevented || !(e.target instanceof HTMLInputElement)) return
        e.preventDefault()
        e.stopPropagation()
        void create()
      }}
    >
      <p className="px-1 text-xs font-medium text-muted">New {schema.labelSingular.toLowerCase()}</p>
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
        {fields.map((field) => {
          const { Input } = rendererFor(field)
          const inputId = `qc-${refTable}-${field.key}`
          return (
            <FieldShell
              key={field.key}
              label={field.label}
              help={field.help}
              error={errors[field.key]}
              htmlFor={inputId}
              inlineLabel={field.type === 'bool'}
            >
              <Input
                field={field}
                value={draft[field.key] ?? ''}
                onChange={(v) => setField(field.key, v)}
                id={inputId}
              />
            </FieldShell>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" variant="primary" className="flex-1" disabled={saving} onClick={() => void create()}>
          {saving ? 'Adding…' : `Add ${schema.labelSingular.toLowerCase()}`}
        </Button>
      </div>
    </div>
  )
}

/**
 * A `ref` field's picker: type to search, results narrow live. A `<select>` stops working once a
 * table has more than a handful of rows — a design table is practically one design per square — so
 * every `ref` gets a search box instead, matching case-insensitively against `field.searchFields`
 * (or every field on the referenced row, if that is not set).
 */
function RefSearchSelect({ field, value, onChange, id }: FieldInputProps) {
  const schema = useTableSchema(field.refTable ?? '')
  const lookup = useLookup(field.refTable ?? '')
  const resolve = useResolveRef()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selectedRow = value !== '' ? lookup.get(value) : undefined
  const selectedLabel = schema && selectedRow ? titleFor(schema, selectedRow) : value

  const results = useMemo(() => {
    if (!schema) return []
    const entries = [...lookup.entries()]
    const matched =
      query.trim() === ''
        ? entries
        : entries.filter(([, row]) => matchesSearch(searchText(schema, row, resolve, field.searchFields), query))
    // Natural order, the same as the lists, so "77 (Sunflower)" comes before "129 (…)".
    return matched.sort((a, b) => compareIds(titleFor(schema, a[1]), titleFor(schema, b[1]))).slice(0, 50)
  }, [schema, lookup, query, resolve, field.searchFields])

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            className={`${inputClass} scroll-mt-16`}
            // While searching, the current choice stays visible as the placeholder rather than vanishing.
            placeholder={selectedLabel || `Search ${schema?.labelSingular.toLowerCase() ?? '…'}`}
            value={open ? query : selectedLabel}
            onFocus={(e) => {
              setOpen(true)
              setQuery('')
              setActive(0)
              // On a touch screen, lift the box towards the top so its results open in view, not under
              // the Save bar or the on-screen keyboard - after a beat, once the keyboard has finished
              // resizing things. With a mouse there is no keyboard to dodge, and the jump is just noise.
              const input = e.currentTarget
              if (window.matchMedia?.('(pointer: coarse)').matches) {
                setTimeout(() => input.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300)
              }
            }}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            // Enter would otherwise submit the whole form - saving the record without the choice you
            // were in the middle of making - so it picks the highlighted match instead.
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const pick = open ? results[active] : undefined
                if (pick) {
                  onChange(pick[0])
                  setQuery('')
                  setOpen(false)
                }
              } else if (e.key === 'Escape' && open) {
                e.preventDefault()
                setOpen(false)
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setOpen(true)
                const step = e.key === 'ArrowDown' ? 1 : -1
                setActive((i) => Math.min(Math.max(i + step, 0), Math.max(results.length - 1, 0)))
              }
            }}
            onBlur={() => {
              // Let the click on a result register before the list disappears.
              setTimeout(() => setOpen(false), 150)
            }}
          />
          {value !== '' ? (
            <Button
              type="button"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange('')
                setQuery('')
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {open ? (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-card shadow-lg">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No matches</li>
            ) : (
              results.map(([rowId, row], i) => (
                <li key={rowId}>
                  <button
                    type="button"
                    className={`tap-target flex w-full items-center gap-2 px-3 text-left text-sm hover:bg-line/40 ${
                      i === active ? 'bg-line/40' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(rowId)
                      setQuery('')
                      setOpen(false)
                    }}
                  >
                    {schema?.swatchField ? (
                      <Swatch
                        hex={row[schema.swatchField]}
                        pattern={schema.patternField ? row[schema.patternField] : undefined}
                        size={14}
                      />
                    ) : null}
                    {schema ? titleFor(schema, row) : rowId}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {/* Keep a dangling reference visible rather than silently resetting it to blank. */}
      {value !== '' && !lookup.has(value) ? (
        <p className="text-sm text-red-600 dark:text-red-400">{value} (missing)</p>
      ) : null}
      {field.quickCreate && field.refTable ? (
        <QuickCreate refTable={field.refTable} onCreated={onChange} />
      ) : null}
    </div>
  )
}

/**
 * Multi-reference stored in a single cell, e.g. `Y03;Y11;Y07`, as a live search plus tap-to-toggle
 * chips rather than a `<select multiple>`, which is close to unusable on a phone. Like a mail
 * client's Bcc field: with the box empty, only what is already selected is shown — not every row in
 * the referenced table — so this stays usable once that table has hundreds of rows (100+ yarn
 * colourways). Typing narrows the offered chips to matches, on top of whatever is already selected.
 * Selection order is preserved, because for a square the order colours were worked in is real
 * information.
 */
function RefListInput({ field, value, onChange }: FieldInputProps) {
  const separator = field.separator ?? ';'
  const selected = splitList(value, separator)
  const schema = useTableSchema(field.refTable ?? '')
  const lookup = useLookup(field.refTable ?? '')
  const resolve = useResolveRef()
  const [query, setQuery] = useState('')

  const toggle = (rowId: string) => {
    const next = selected.includes(rowId)
      ? selected.filter((s) => s !== rowId)
      : [...selected, rowId]
    onChange(joinList(next, separator))
  }

  const entries = [...lookup.entries()]
  const searching = query.trim() !== ''
  const visible = schema
    ? entries.filter(
        ([rowId, row]) =>
          selected.includes(rowId) ||
          (searching && matchesSearch(searchText(schema, row, resolve, field.searchFields), query)),
      )
    : entries

  return (
    <div className="space-y-2">
      {entries.length > 0 ? (
        <input
          type="search"
          className={inputClass}
          placeholder={`Search ${schema?.label.toLowerCase() ?? '…'}`}
          aria-label={`Search ${schema?.label.toLowerCase() ?? ''} to add to ${field.label.toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="done"
          onKeyDown={(e) => {
            // Adds the first match not already picked, rather than submitting the form around it.
            if (e.key !== 'Enter') return
            e.preventDefault()
            const first = searching ? visible.find(([rowId]) => !selected.includes(rowId)) : undefined
            if (first) {
              toggle(first[0])
              setQuery('')
            }
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {visible.map(([rowId, row]) => {
          const active = selected.includes(rowId)
          const position = selected.indexOf(rowId) + 1
          return (
            <button
              key={rowId}
              type="button"
              onClick={() => toggle(rowId)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition ${
                active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card'
              }`}
            >
              {schema?.swatchField ? (
                <Swatch
                  hex={row[schema.swatchField]}
                  pattern={schema.patternField ? row[schema.patternField] : undefined}
                  size={14}
                />
              ) : null}
              {schema ? titleFor(schema, row) : rowId}
              {active ? <span className="text-xs opacity-70">{position}</span> : null}
            </button>
          )
        })}
        {entries.length === 0 ? <Muted>Nothing to pick from yet.</Muted> : null}
        {entries.length > 0 && !searching && visible.length === 0 ? (
          <Muted>Type to search — nothing selected yet.</Muted>
        ) : null}
        {entries.length > 0 && searching && visible.length === 0 ? <Muted>No matches.</Muted> : null}
      </div>
    </div>
  )
}

const VALID_HEX6 = /^#[0-9a-fA-F]{6}$/

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = VALID_HEX6.exec(hex)
  if (!m) return null
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * One colour: a native picker, a hex text box, and RGB number boxes, all views of the same hex string
 * — there is nothing else to store, so editing any of them just writes back a recomputed hex value
 * rather than tracking RGB as separate state that could drift out of sync with it.
 */
function ColorPickerRow({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
}) {
  const valid = VALID_HEX6.test(value)
  const rgb = hexToRgb(valid ? value : '#cccccc') ?? { r: 204, g: 204, b: 204 }
  const setChannel = (channel: 'r' | 'g' | 'b', v: number) => {
    const next = { ...rgb, [channel]: v }
    onChange(rgbToHex(next.r, next.g, next.b))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        type="color"
        aria-label="Colour picker"
        className="tap-target size-11 shrink-0 rounded-xl border border-line bg-card p-1"
        value={valid ? value : '#cccccc'}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        id={id}
        type="text"
        className={`${inputClass} min-w-0 flex-1 font-mono`}
        placeholder="#C98B94"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
        RGB
        {(['r', 'g', 'b'] as const).map((channel) => (
          <input
            key={channel}
            type="number"
            min={0}
            max={255}
            aria-label={channel.toUpperCase()}
            // Not `inputClass`: its `w-full` wins over a width set here and stretches each box across the row.
            className="tap-target w-14 rounded-xl border border-line bg-card px-1.5 py-1 text-center text-sm outline-none focus:border-accent"
            value={rgb[channel]}
            onChange={(e) => setChannel(channel, Number(e.target.value))}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * More than one colour in a single cell (`#111;#222`), same `;`-joined-list-in-one-cell pattern as
 * `reflist` — a variegated yarn's colourway is a handful of hex values, not enough to earn a join
 * table. The first is the colour a `solid`/`print` `Swatch` fills with, or the base a `speckled` one
 * scatters the rest across (see `colourStyle`) — so order matters, and the ▲▼ buttons move a colour
 * without retyping it, e.g. to bring a speckled yarn's base shade to the front. "+" appends another,
 * each added one gets its own "−". See ADR 0019, ADR 0024.
 */
function ColorListInput({ field, value, onChange, id }: FieldInputProps) {
  const separator = field.separator ?? ';'
  const colours = splitList(value, separator)

  const setColour = (i: number, hex: string) => {
    const next = [...colours]
    next[i] = hex
    onChange(joinList(next, separator))
  }
  const addColour = () => onChange(joinList([...colours, '#cccccc'], separator))
  const removeColour = (i: number) => onChange(joinList(colours.filter((_, idx) => idx !== i), separator))
  const moveColour = (i: number, direction: -1 | 1) => {
    const j = i + direction
    if (j < 0 || j >= colours.length) return
    const next = [...colours]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(joinList(next, separator))
  }

  if (colours.length === 0) {
    return (
      <Button type="button" variant="secondary" onClick={addColour}>
        + Add colour
      </Button>
    )
  }

  return (
    <div className="space-y-2">
      {colours.map((hex, i) => (
        <div key={i} className="flex items-center gap-2">
          {colours.length > 1 ? (
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                className="px-2 py-1.5 text-xs leading-tight text-muted hover:text-ink disabled:opacity-30"
                disabled={i === 0}
                onClick={() => moveColour(i, -1)}
                aria-label="Move colour earlier"
              >
                ▲
              </button>
              <button
                type="button"
                className="px-2 py-1.5 text-xs leading-tight text-muted hover:text-ink disabled:opacity-30"
                disabled={i === colours.length - 1}
                onClick={() => moveColour(i, 1)}
                aria-label="Move colour later"
              >
                ▼
              </button>
            </div>
          ) : null}
          <ColorPickerRow value={hex} onChange={(v) => setColour(i, v)} id={i === 0 ? id : undefined} />
          {i === 0 ? (
            <Button type="button" variant="secondary" className="shrink-0 self-start px-3" onClick={addColour} aria-label="Add another colour">
              +
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 self-start px-3"
              onClick={() => removeColour(i)}
              aria-label="Remove this colour"
            >
              −
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

function textInput(type: string, inputMode?: string): FieldRenderer['Input'] {
  return ({ value, onChange, id, field }) => (
    <input
      id={id}
      type={type}
      inputMode={inputMode as never}
      className={inputClass}
      value={value}
      placeholder={field.type === 'url' ? 'https://' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

const URL_IN_TEXT = /(https?:\/\/[^\s]+[^\s.,;:!?)\]'"])/g

/**
 * Free text with any web address in it made tappable - a design's notes often hold the pattern's
 * page, and copying a URL out of a read-only line on a phone is fiddly. Trailing punctuation stays
 * outside the link, so "see https://example.com." does not link the full stop.
 */
function TextWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_IN_TEXT)
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        // `split` with a capturing group puts each match at an odd index.
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-accent underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  )
}

const plainDisplay: FieldRenderer['Display'] = ({ value }) =>
  value === '' ? <Muted>-</Muted> : <TextWithLinks text={value} />

export const fieldRenderers: Record<FieldType, FieldRenderer> = {
  id: {
    // Ids are assigned, never typed. Showing it read-only avoids creating a second record by
    // accident when you meant to rename one.
    Input: ({ value }) => (
      <div className={`${inputClass} bg-line/30 text-muted`}>{value || '—'}</div>
    ),
    Display: ({ value }) => <span className="font-mono text-sm">{value}</span>,
  },

  text: { Input: textInput('text'), Display: plainDisplay },

  textarea: {
    Input: ({ value, onChange, id }) => (
      <textarea
        id={id}
        rows={3}
        className={`${inputClass} min-h-[5.5rem] resize-y`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
    Display: plainDisplay,
  },

  number: { Input: textInput('text', 'decimal'), Display: plainDisplay },

  date: {
    Input: textInput('date'),
    Display: ({ value }) => (value === '' ? <Muted>—</Muted> : <span>{value}</span>),
  },

  bool: {
    Input: ({ value, onChange, id, field }) => (
      <label htmlFor={id} className="tap-target inline-flex items-center gap-3">
        <input
          id={id}
          type="checkbox"
          className="size-5 accent-[var(--color-accent)]"
          checked={parseBool(value)}
          onChange={(e) => onChange(formatBool(e.target.checked))}
        />
        <span className="text-sm">{field.label}</span>
      </label>
    ),
    Display: ({ value }) => <span>{parseBool(value) ? 'Yes' : 'No'}</span>,
  },

  enum: {
    Input: ({ field, value, onChange, id }) => (
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value !== '' && !(field.options ?? []).includes(value) ? (
          <option value={value}>{value} (not in schema)</option>
        ) : null}
      </select>
    ),
    Display: plainDisplay,
  },

  ref: {
    Input: RefSearchSelect,
    Display: ({ field, value }) => {
      if (value === '') return <Muted>—</Muted>
      return (
        <span className="block">
          <RefChip id={value} refTable={field.refTable} />
          {field.detailFields && field.refTable ? (
            <RefDetailFields id={value} refTable={field.refTable} keys={field.detailFields} />
          ) : null}
        </span>
      )
    },
  },

  reflist: {
    Input: RefListInput,
    Display: ({ field, value }) => {
      const ids = splitList(value, field.separator ?? ';')
      if (ids.length === 0) return <Muted>—</Muted>
      return (
        <span className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <RefChip key={id} id={id} refTable={field.refTable} />
          ))}
        </span>
      )
    },
  },

  color: {
    Input: ({ value, onChange, id }) => <ColorPickerRow value={value} onChange={onChange} id={id} />,
    Display: ({ value }) =>
      value === '' ? (
        <Muted>—</Muted>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Swatch hex={value} />
          <span className="font-mono text-sm">{value}</span>
        </span>
      ),
  },

  colorlist: {
    Input: ColorListInput,
    Display: ({ field, value, row, schema }) => {
      const colours = splitList(value, field.separator ?? ';')
      if (colours.length === 0) return <Muted>—</Muted>
      // Only meaningful when this colorlist field is the row's swatch — a table could in principle
      // have more than one colorlist field, and `patternField` describes just the one.
      const pattern =
        row && schema?.patternField && schema.swatchField === field.key ? row[schema.patternField] : undefined
      return (
        <span className="inline-flex items-center gap-2">
          <Swatch hex={value} pattern={pattern} size={28} />
          <span className="font-mono text-sm">{colours.join(', ')}</span>
        </span>
      )
    },
  },

  url: {
    Input: textInput('url', 'url'),
    Display: ({ value }) =>
      value === '' ? (
        <Muted>—</Muted>
      ) : (
        <a
          href={value}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-accent underline underline-offset-2"
        >
          {value}
        </a>
      ),
  },
}

export function rendererFor(field: FieldDef): FieldRenderer {
  return fieldRenderers[field.type] ?? fieldRenderers.text
}

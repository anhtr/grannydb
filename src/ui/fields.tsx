import { useMemo, useState, type ReactNode } from 'react'
import type { CsvRow } from '../core/csv'
import { today } from '../core/date'
import type { FieldDef, FieldType } from '../core/schema'
import {
  formatBool,
  joinList,
  matchesSearch,
  parseBool,
  searchText,
  splitList,
  titleFor,
  validateValue,
} from '../core/schema'
import { appStore } from '../core/store'
import { useLookup, useRefIds, useResolveRef, useTableSchema } from '../app/hooks'
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
}

export interface FieldDisplayProps {
  field: FieldDef
  value: string
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
  return (id: string): { label: string; hex?: string; missing: boolean } => {
    if (!schema) return { label: id, missing: false }
    const row = lookup.get(id)
    if (!row) return { label: id, missing: id !== '' }
    return {
      label: titleFor(schema, row),
      hex: schema.swatchField ? row[schema.swatchField] : undefined,
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
      {info.hex !== undefined ? <Swatch hex={info.hex} size={14} /> : null}
      {info.label}
      {info.missing ? ' (missing)' : ''}
    </span>
  )
  if (info.missing || !refTable) return content
  return <Link to={`/${refTable}/${id}`}>{content}</Link>
}

/** Every field of a quick-create target except its id, which is assigned on save, not typed. */
function quickCreateFields(fields: FieldDef[], idField: string): FieldDef[] {
  return fields.filter((f) => f.key !== idField)
}

function initialQuickCreateDraft(fields: FieldDef[]): CsvRow {
  const draft: CsvRow = {}
  for (const field of fields) {
    draft[field.key] = field.type === 'date' && field.defaultToday ? today() : (field.default ?? '')
  }
  return draft
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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  if (!schema) return null
  const fields = quickCreateFields(schema.fields, schema.idField)

  const setField = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
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
          setDraft(initialQuickCreateDraft(fields))
          setErrors({})
          setOpen(true)
        }}
      >
        + New {schema.labelSingular.toLowerCase()}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-paper p-2">
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

  const selectedRow = value !== '' ? lookup.get(value) : undefined
  const selectedLabel = schema && selectedRow ? titleFor(schema, selectedRow) : value

  const results = useMemo(() => {
    if (!schema) return []
    const entries = [...lookup.entries()]
    const matched =
      query.trim() === ''
        ? entries
        : entries.filter(([, row]) => matchesSearch(searchText(schema, row, resolve, field.searchFields), query))
    return matched.sort((a, b) => titleFor(schema, a[1]).localeCompare(titleFor(schema, b[1]))).slice(0, 50)
  }, [schema, lookup, query, resolve, field.searchFields])

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            className={inputClass}
            placeholder={`Search ${schema?.labelSingular.toLowerCase() ?? '…'}`}
            value={open ? query : selectedLabel}
            onFocus={() => {
              setOpen(true)
              setQuery('')
            }}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
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
              results.map(([rowId, row]) => (
                <li key={rowId}>
                  <button
                    type="button"
                    className="tap-target flex w-full items-center gap-2 px-3 text-left text-sm hover:bg-line/40"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(rowId)
                      setQuery('')
                      setOpen(false)
                    }}
                  >
                    {schema?.swatchField ? <Swatch hex={row[schema.swatchField]} size={14} /> : null}
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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
              {schema?.swatchField ? <Swatch hex={row[schema.swatchField]} size={14} /> : null}
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
            className={`${inputClass} w-14 px-1.5 py-1 text-center text-sm`}
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
 * table. The first is the yarn's primary colour (what `Swatch` fills with); "+" appends another,
 * each added one gets its own "−". See ADR 0019.
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
          <ColorPickerRow value={hex} onChange={(v) => setColour(i, v)} id={i === 0 ? id : undefined} />
          {i === 0 ? (
            <Button type="button" variant="ghost" className="shrink-0 px-3" onClick={addColour} aria-label="Add another colour">
              +
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 px-3"
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

const plainDisplay: FieldRenderer['Display'] = ({ value }) =>
  value === '' ? <Muted>—</Muted> : <span className="whitespace-pre-wrap">{value}</span>

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
    Display: ({ field, value }) =>
      value === '' ? <Muted>—</Muted> : <RefChip id={value} refTable={field.refTable} />,
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
    Display: ({ field, value }) => {
      const colours = splitList(value, field.separator ?? ';')
      if (colours.length === 0) return <Muted>—</Muted>
      return (
        <span className="inline-flex items-center gap-2">
          <Swatch hex={value} size={28} />
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
          className="text-accent underline underline-offset-2"
        >
          {value}
        </a>
      ),
  },
}

export function rendererFor(field: FieldDef): FieldRenderer {
  return fieldRenderers[field.type] ?? fieldRenderers.text
}

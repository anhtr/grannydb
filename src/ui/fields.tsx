import { useMemo, useState, type ReactNode } from 'react'
import type { FieldDef, FieldType } from '../core/schema'
import { formatBool, joinList, matchesSearch, parseBool, searchText, splitList, titleFor } from '../core/schema'
import { appStore } from '../core/store'
import { useLookup, useResolveRef, useTableSchema } from '../app/hooks'
import { Button, inputClass, Link, Swatch } from './components'

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

/**
 * "+ New <thing>" inline on a `ref` field, for a target table where most rows are one-offs. Creates
 * a row with only its title field set — anything else is filled in later from that table's own
 * screen — then selects it. See ADR 0010.
 */
function QuickCreate({ refTable, onCreated }: { refTable: string; onCreated: (id: string) => void }) {
  const schema = useTableSchema(refTable)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  if (!schema) return null

  const create = async () => {
    const title = draft.trim()
    if (title === '' || saving) return
    setSaving(true)
    try {
      const newId = appStore.nextIdFor(refTable)
      await appStore.save(refTable, newId, { [schema.titleField]: title })
      onCreated(newId)
      setOpen(false)
      setDraft('')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-accent underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
      >
        + New {schema.labelSingular.toLowerCase()}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        autoFocus
        type="text"
        className={inputClass}
        placeholder={`New ${schema.labelSingular.toLowerCase()} name`}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void create()
          } else if (e.key === 'Escape') {
            setOpen(false)
            setDraft('')
          }
        }}
      />
      <Button onClick={() => void create()} disabled={saving || draft.trim() === ''}>
        {saving ? 'Adding…' : 'Add'}
      </Button>
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
    Input: ({ value, onChange, id }) => (
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Colour picker"
          className="tap-target size-11 shrink-0 rounded-xl border border-line bg-card p-1"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={id}
          type="text"
          className={`${inputClass} font-mono`}
          placeholder="#C98B94"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    ),
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

import { useState, type ReactNode } from 'react'
import type { FieldDef, FieldType } from '../core/schema'
import { formatBool, joinList, parseBool, splitList } from '../core/schema'
import { appStore } from '../core/store'
import { useLookup, useTableSchema } from '../app/hooks'
import { Button, inputClass, Swatch } from './components'

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
      label: row[schema.titleField] || id,
      hex: schema.swatchField ? row[schema.swatchField] : undefined,
      missing: false,
    }
  }
}

function RefChip({ id, refTable }: { id: string; refTable?: string }) {
  const info = useRefInfo(refTable)(id)
  return (
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

function RefSelect({ field, value, onChange, id }: FieldInputProps) {
  const schema = useTableSchema(field.refTable ?? '')
  const lookup = useLookup(field.refTable ?? '')
  const options = [...lookup.entries()]

  return (
    <div className="space-y-2">
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map(([rowId, row]) => (
          <option key={rowId} value={rowId}>
            {schema ? row[schema.titleField] || rowId : rowId}
          </option>
        ))}
        {/* Keep a dangling reference visible rather than silently resetting it to blank. */}
        {value !== '' && !lookup.has(value) ? (
          <option value={value}>{value} (missing)</option>
        ) : null}
      </select>
      {field.quickCreate && field.refTable ? (
        <QuickCreate refTable={field.refTable} onCreated={onChange} />
      ) : null}
    </div>
  )
}

/**
 * Multi-reference stored in a single cell, e.g. `Y03;Y11;Y07`.
 *
 * Rendered as tap-to-toggle chips rather than a multi-select, which is close to unusable on a
 * phone. Selection order is preserved, because for a square the order the colours were worked in
 * is real information.
 */
function RefListInput({ field, value, onChange }: FieldInputProps) {
  const separator = field.separator ?? ';'
  const selected = splitList(value, separator)
  const schema = useTableSchema(field.refTable ?? '')
  const lookup = useLookup(field.refTable ?? '')

  const toggle = (rowId: string) => {
    const next = selected.includes(rowId)
      ? selected.filter((s) => s !== rowId)
      : [...selected, rowId]
    onChange(joinList(next, separator))
  }

  return (
    <div className="flex flex-wrap gap-2">
      {[...lookup.entries()].map(([rowId, row]) => {
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
            {schema ? row[schema.titleField] || rowId : rowId}
            {active ? <span className="text-xs opacity-70">{position}</span> : null}
          </button>
        )
      })}
      {lookup.size === 0 ? <Muted>Nothing to pick from yet.</Muted> : null}
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
    Input: RefSelect,
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

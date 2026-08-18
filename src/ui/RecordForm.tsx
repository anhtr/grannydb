import { useMemo, useState } from 'react'
import type { CsvRow } from '../core/csv'
import { idSet, validateValue } from '../core/schema'
import type { TableSchema } from '../core/schema'
import { appStore } from '../core/store'
import { useAppState, useRow, useTableSchema } from '../app/hooks'
import { useNavigate } from '../app/router'
import { Button, ErrorNote, FieldShell, Spinner } from './components'
import { rendererFor } from './fields'

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function initialValues(schema: TableSchema, row: CsvRow | null, newId: string): CsvRow {
  const values: CsvRow = {}
  for (const field of schema.fields) {
    if (row) {
      values[field.key] = row[field.key] ?? ''
    } else if (field.key === schema.idField) {
      values[field.key] = newId
    } else if (field.type === 'date' && field.defaultToday) {
      values[field.key] = today()
    } else {
      values[field.key] = field.default ?? ''
    }
  }
  return values
}

/**
 * The one form in the app.
 *
 * Every table gets its editor from its schema, so adding a field to `squares.json` puts a control
 * on this form with no code change. That is the whole reason the schema is data.
 */
export function RecordForm({ table, id }: { table: string; id?: string }) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const existing = useRow(table, id)
  const navigate = useNavigate()

  const newId = useMemo(
    () => (id ? '' : appStore.nextIdFor(table)),
    // Recompute once the data is in; the next id depends on what already exists.
    [id, table, state.data[table]],
  )

  const [values, setValues] = useState<CsvRow | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Ids available in each referenced table, so a `ref` pointing nowhere is caught before saving.
  const refIds = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    if (!state.snapshot) return map
    for (const name of state.snapshot.schemas.order) {
      const s = state.snapshot.schemas.tables[name]
      const t = state.data[name]
      if (s && t) map[name] = idSet(t, s.idField)
    }
    return map
  }, [state.snapshot, state.data])

  if (!schema) return <Spinner label="Loading schema" />
  if (id && !existing) {
    return <ErrorNote>No {schema.labelSingular.toLowerCase()} with id {id}.</ErrorNote>
  }

  const current = values ?? initialValues(schema, existing, newId)
  const recordId = current[schema.idField] || newId

  const setField = (key: string, value: string) => {
    setValues({ ...current, [key]: value })
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const onSave = async () => {
    const found: Record<string, string> = {}
    for (const field of schema.fields) {
      const message = validateValue(
        field,
        current[field.key] ?? '',
        field.refTable ? refIds[field.refTable] : undefined,
      )
      if (message) found[field.key] = message
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      await appStore.save(table, recordId, current)
      navigate(`/${table}/${recordId}`, { replace: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="pb-28"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave()
      }}
    >
      <div className="mx-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {schema.fields.map((field) => {
          const { Input } = rendererFor(field)
          const inputId = `f-${table}-${field.key}`
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
                value={current[field.key] ?? ''}
                onChange={(v) => setField(field.key, v)}
                id={inputId}
              />
            </FieldShell>
          )
        })}
      </div>

      {/* Sticky so Save is always in thumb reach on a long form. */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-paper/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => navigate(id ? `/${table}/${id}` : `/${table}`)}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-[2]" disabled={saving}>
            {saving ? 'Saving…' : `Save ${schema.labelSingular.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </form>
  )
}

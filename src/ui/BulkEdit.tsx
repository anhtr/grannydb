import { useId, useMemo, useState } from 'react'
import type { CsvRow } from '../core/csv'
import { bulkEditableFields, bulkEditNeedsDate, fieldByKey, planBulkEdit } from '../core/schema'
import type { BulkEditPlan, FieldDef, TableSchema } from '../core/schema'
import { appStore } from '../core/store'
import { useRefIds, useToday } from '../app/hooks'
import { Button, FieldShell, inputClass } from './components'
import { useDialog } from './dialog'
import { rendererFor } from './fields'

/** "3 squares", "1 square" - the table's own words for its rows. */
export function countNoun(schema: TableSchema, n: number): string {
  return `${n} ${(n === 1 ? schema.labelSingular : schema.label).toLowerCase()}`
}

/**
 * The bar a list shows while rows are being selected, in the place its New button normally has -
 * the same thumb reach, and a list that is being selected from is not one that is being added to.
 */
export function SelectionBar({
  count,
  shown,
  onSelectAll,
  onSelectNone,
  onCancel,
  onChange,
}: {
  count: number
  /** How many rows the list is showing, which is what "All" selects. */
  shown: number
  onSelectAll: () => void
  onSelectNone: () => void
  onCancel: () => void
  onChange: () => void
}) {
  const all = shown > 0 && count === shown
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--footer-height,4rem)] z-20 px-4 pb-2">
      <div
        role="toolbar"
        aria-label="Selection"
        className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-card p-2 shadow-lg shadow-black/20"
      >
        <p className="min-w-0 flex-1 whitespace-nowrap px-1.5 text-sm" aria-live="polite">
          {count} selected
        </p>
        <Button variant="ghost" onClick={all ? onSelectNone : onSelectAll}>
          {all ? 'None' : `All ${shown}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={count === 0} onClick={onChange}>
          Change…
        </Button>
      </div>
    </div>
  )
}

function defaultField(schema: TableSchema, fields: FieldDef[]): string {
  // The status first where there is one: moving a batch along is what selecting a batch is mostly for.
  const status = schema.statusDates ? fieldByKey(schema, schema.statusDates.field) : undefined
  return (status && fields.includes(status) ? status : fields[0])?.key ?? ''
}

/**
 * Set one field to one value on every selected row.
 *
 * The plan (`planBulkEdit`) is recomputed as the value is chosen and shown **before** anything is
 * queued: how many rows will change, how many already hold the value, and which would break a rule
 * and so will be left alone, with the rule. Apply then queues exactly what was shown. That is the
 * confirmation step, in place of an "Are you sure?" that could only repeat the count.
 *
 * One field at a time, and no bulk delete: each of those multiplies what a single mistaken tap can
 * do, and a second pass through this dialog is cheap.
 */
export function BulkEditDialog({
  table,
  schema,
  rows,
  onClose,
  onApplied,
}: {
  table: string
  schema: TableSchema
  rows: CsvRow[]
  onClose: () => void
  onApplied: (plan: BulkEditPlan, field: FieldDef) => void
}) {
  const fields = useMemo(() => bulkEditableFields(schema), [schema])
  const refIds = useRefIds()
  const today = useToday()
  const [fieldKey, setFieldKey] = useState(() => defaultField(schema, fields))
  const [value, setValue] = useState('')
  // Nothing is previewed or applicable until a value has been chosen on purpose: an untouched input
  // reads as blank, and blank is a real instruction here ("clear this field").
  const [touched, setTouched] = useState(false)
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const ref = useDialog<HTMLDivElement>(onClose, { modal: true })
  const titleId = useId()
  const baseId = useId()

  const field = fieldByKey(schema, fieldKey)
  const needsDate = bulkEditNeedsDate(schema, fieldKey, value)
  const plan = useMemo(
    () =>
      touched && field
        ? planBulkEdit(schema, rows, fieldKey, value, {
            date,
            refIds: field.refTable ? refIds[field.refTable] : undefined,
          })
        : null,
    [touched, field, schema, rows, fieldKey, value, date, refIds],
  )

  const apply = async () => {
    if (!plan || !field || plan.error || plan.writes.length === 0 || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await appStore.saveMany(table, plan.writes)
      onApplied(plan, field)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const Input = field ? rendererFor(field).Input : null
  const clearing = touched && value.trim() === ''
  const writes = plan?.writes.length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[6dvh]" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-paper p-3 shadow-lg outline-none"
        // A click inside is not a click on the backdrop.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="px-1 font-medium">
          Change {countNoun(schema, rows.length)}
        </h2>

        <div className="divide-y divide-line rounded-xl border border-line bg-card">
          <FieldShell label="Field" htmlFor={`${baseId}-field`}>
            <select
              id={`${baseId}-field`}
              className={inputClass}
              value={fieldKey}
              onChange={(e) => {
                setFieldKey(e.target.value)
                setValue('')
                setTouched(false)
              }}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </FieldShell>

          {field && Input ? (
            <FieldShell
              label="Set to"
              help={field.type === 'bool' ? 'Tick, or tick and untick, to choose.' : field.help}
              htmlFor={`${baseId}-value`}
              inlineLabel={field.type === 'bool'}
            >
              <Input
                // Remounted per field, so one field's picker state (a search in progress) never
                // carries over into the next field's input.
                key={field.key}
                field={field}
                value={value}
                onChange={(v) => {
                  setValue(v)
                  setTouched(true)
                }}
                id={`${baseId}-value`}
                schema={schema}
              />
            </FieldShell>
          ) : null}

          {needsDate ? (
            <FieldShell
              label="On"
              help="Fills that date where it is blank. A date already recorded is kept."
              htmlFor={`${baseId}-date`}
            >
              <input
                id={`${baseId}-date`}
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FieldShell>
          ) : null}
        </div>

        <div className="space-y-1.5 px-1 text-sm" aria-live="polite">
          {!plan ? (
            <p className="text-muted">Choose a value to see what will change.</p>
          ) : plan.error ? (
            <p className="text-red-600 dark:text-red-400">{plan.error}</p>
          ) : (
            <>
              <p>
                {writes === 0
                  ? 'Nothing to change.'
                  : `${clearing ? 'Clears' : 'Changes'} ${field?.label.toLowerCase()} on ${countNoun(schema, writes)}.`}
                {plan.unchanged.length > 0 ? ` ${plan.unchanged.length} already ${clearing ? 'blank' : 'set'}.` : ''}
              </p>
              {plan.skipped.length > 0 ? (
                <div>
                  <p className="text-amber-700 dark:text-amber-300">
                    {plan.skipped.length} will be left as {plan.skipped.length === 1 ? 'it is' : 'they are'}:
                  </p>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted">
                    {plan.skipped.map((skip) => (
                      <li key={skip.id}>
                        <span className="font-mono">{skip.id}</span> - {skip.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>

        {failure ? (
          <p role="alert" className="px-1 text-sm text-red-600 dark:text-red-400">
            {failure}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || !plan || plan.error !== null || writes === 0}
            onClick={() => void apply()}
          >
            {busy ? 'Applying…' : writes > 0 ? `${clearing ? 'Clear' : 'Change'} ${writes}` : 'Change'}
          </Button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FieldDef, IncomingReference } from '../core/schema'
import type { ReactNode } from 'react'
import { appStore } from '../core/store'
import { fileUrl } from '../core/github'
import { effectiveValue, fieldByKey, referencesTo, stepCount, titleFor } from '../core/schema'
import { useAppState, useCanEdit, useResolveRef, useRow, useTable, useTableSchema } from '../app/hooks'
import { navigate as routerNavigate, useNavigate } from '../app/router'
import { Button, Card, ErrorNote, Link, Spinner } from './components'
import { rendererFor } from './fields'
import { neighbours, recordOrder } from './listOrder'
import { notify } from './toast'

/**
 * `extra` is a slot for read-only sections a table wants under its fields — computed views such as a
 * yarn's colour combinations, which are not schema fields and so have no `Display` to render them.
 * It is passed in by the caller rather than looked up here, so `ui/` never imports from `features/`.
 */
/**
 * A `stepper` number on the record page: the value with a - and a + beside it, each tap saved
 * straight away as an ordinary one-field edit. This is the one place a record page writes without
 * going through the form, and it is deliberate - "used a skein" happens with a hook in the other
 * hand, and Edit, find the box, retype, Save is four steps too many for it.
 *
 * No confirmation and no Undo message: the number changes where the finger is, and the opposite
 * button is the undo. Taps are ignored while one is being saved, so a double tap cannot read the
 * same starting value twice and count once.
 */
function CountStepper({ table, id, field, value }: { table: string; id: string; field: FieldDef; value: string }) {
  const [busy, setBusy] = useState(false)
  const step = async (delta: number) => {
    const next = stepCount(value, delta)
    if (busy || next === value) return
    setBusy(true)
    try {
      await appStore.save(table, id, { [field.key]: next })
    } finally {
      setBusy(false)
    }
  }
  const label = field.label.toLowerCase()
  return (
    // The negative margin gives back the height two 44px buttons would add to this one row.
    <span className="-my-2 flex items-center gap-3">
      <Button
        className="px-4"
        disabled={stepCount(value, -1) === value}
        onClick={() => void step(-1)}
        aria-label={`Decrease ${label}`}
      >
        −
      </Button>
      <span className="min-w-6 text-center tabular-nums" aria-live="polite">
        {value === '' ? '-' : value}
      </span>
      <Button className="px-4" disabled={stepCount(value, 1) === value} onClick={() => void step(1)} aria-label={`Increase ${label}`}>
        +
      </Button>
    </span>
  )
}

export function RecordDetail({ table, id, extra }: { table: string; id: string; extra?: ReactNode }) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const row = useRow(table, id)
  const data = useTable(table)
  const canEdit = useCanEdit()
  const navigate = useNavigate()
  const resolve = useResolveRef()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  // The impact note opens above the buttons and pushes "Really delete" down, often under the bottom
  // bar; bring the buttons back into view so the confirm step is not hidden behind its own warning.
  useEffect(() => {
    if (confirmingDelete) actionsRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [confirmingDelete])

  const pager = useMemo(() => {
    if (!schema || !data) return null
    return neighbours(recordOrder(table, data.rows.map((r) => r[schema.idField] ?? '')), id)
  }, [schema, data, table, id])

  if (!schema) return <Spinner label="Loading schema" />
  if (!row) {
    return (
      <div className="space-y-4 p-4">
        <ErrorNote>Nothing here with id {id}.</ErrorNote>
        <Link to={`/${table}`} className="text-accent underline underline-offset-2">
          Back to {schema.label.toLowerCase()}
        </Link>
      </div>
    )
  }

  const onDelete = async () => {
    // Read before the delete: afterwards there is no row to take a name from.
    const noun = schema.labelSingular.toLowerCase()
    const name = titleFor(schema, row) || id
    const receipt = await appStore.remove(table, id)
    navigate(`/${table}`, { replace: true })
    notify(`Deleted ${noun} ${name}`, {
      action: {
        label: 'Undo',
        run: async () => {
          const undone = await appStore.undoRemove(receipt)
          if (undone) notify(`Restored ${noun} ${name}`)
          else notify(`Too late to undo - the delete of ${name} has been synced`, { tone: 'warn' })
        },
      },
    })
  }

  return (
    <div className="space-y-4 pb-24">
      {pager && pager.total > 1 ? (
        <nav
          aria-label={`${schema.label} in list order`}
          className="mx-4 flex items-center justify-between gap-2 text-sm"
        >
          <PagerLink table={table} id={pager.previous} label={`Previous ${schema.labelSingular.toLowerCase()}`}>
            ‹ Previous
          </PagerLink>
          <span className="text-xs text-muted">
            {pager.position} of {pager.total}
          </span>
          <PagerLink table={table} id={pager.next} label={`Next ${schema.labelSingular.toLowerCase()}`}>
            Next ›
          </PagerLink>
        </nav>
      ) : null}

      <Card className="mx-4 divide-y divide-line overflow-hidden">
        {schema.fields.map((field) => {
          const { Display } = rendererFor(field)
          const { value, inherited } = field.inheritFrom
            ? effectiveValue(schema, field, row, resolve)
            : { value: row[field.key] ?? '', inherited: false }
          const viaField = inherited ? fieldByKey(schema, field.inheritFrom!.via) : undefined
          return (
            <div key={field.key} className="flex gap-4 px-4 py-3">
              <span className="w-32 shrink-0 text-sm text-muted">{field.label}</span>
              <span className="min-w-0 flex-1">
                {canEdit && field.type === 'number' && field.stepper ? (
                  <CountStepper table={table} id={id} field={field} value={value} />
                ) : (
                  <Display field={field} value={value} row={row} schema={schema} />
                )}
                {inherited ? (
                  <span className="ml-2 text-xs text-muted">
                    (from {viaField ? viaField.label.toLowerCase() : 'related record'})
                  </span>
                ) : null}
              </span>
            </div>
          )
        })}
      </Card>

      {extra}

      {canEdit && confirmingDelete && state.snapshot ? (
        <DeleteImpact
          references={referencesTo(state.snapshot.schemas, state.data, table, id)}
          what={schema.labelSingular.toLowerCase()}
        />
      ) : null}

      {canEdit ? (
        <div ref={actionsRef} className="flex scroll-mb-[calc(var(--footer-height,4rem)+1rem)] gap-3 px-4">
          <Button variant="primary" className="flex-1" onClick={() => navigate(`/${table}/${id}/edit`)}>
            Edit
          </Button>
          {confirmingDelete ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
              <Button variant="danger" onClick={() => void onDelete()}>
                Really delete
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      ) : (
        <p className="px-4 text-sm text-muted">
          Read-only. Add a GitHub token in{' '}
          <Link to="/settings" className="text-accent underline underline-offset-2">
            Settings
          </Link>{' '}
          to edit.
        </p>
      )}

      <p className="px-4 text-xs text-muted">
        Stored in{' '}
        <a
          href={fileUrl(state.config, schema.file)}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          {schema.file}
        </a>
      </p>
    </div>
  )
}

/**
 * One end of the pager. A real link, so it can be opened in a new tab or read out as one, but a plain
 * tap *replaces* the history entry instead of adding to it: stepping through twenty records and then
 * pressing Back should land on the list, not on record nineteen. At either end of the list it stays in
 * place as dimmed text, so the other button does not jump sideways under the thumb.
 */
function PagerLink({
  table,
  id,
  label,
  children,
}: {
  table: string
  id: string | null
  label: string
  children: ReactNode
}) {
  const className = 'tap-target flex items-center rounded-lg px-2'
  if (id === null) {
    return (
      <span aria-hidden className={`${className} text-muted opacity-40`}>
        {children}
      </span>
    )
  }
  const to = `/${table}/${id}`
  return (
    <a
      href={`#${to}`}
      aria-label={`${label}, ${id}`}
      className={`${className} text-accent`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        routerNavigate(to, { replace: true })
      }}
    >
      {children}
    </a>
  )
}

/**
 * What a delete would orphan, shown while it waits for "Really delete". Deleting stays allowed - the
 * rows can be repointed afterwards - but a dangling reference fails the deploy's data check, so it
 * should never be a surprise.
 */
function DeleteImpact({ references, what }: { references: IncomingReference[]; what: string }) {
  const schemas = useAppState().snapshot?.schemas
  if (references.length === 0) return null
  return (
    <div className="mx-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      {references.map(({ table, field, rowIds }) => {
        const label = schemas?.tables[table]
        const noun = rowIds.length === 1 ? label?.labelSingular : label?.label
        return (
          <p key={`${table}.${field.key}`}>
            {rowIds.length} {(noun ?? table).toLowerCase()} use{rowIds.length === 1 ? 's' : ''} this {what} as{' '}
            {field.label.toLowerCase()}:{' '}
            {rowIds.map((rowId, i) => (
              <span key={rowId}>
                {i > 0 ? ', ' : ''}
                <Link to={`/${table}/${rowId}`} className="font-mono underline underline-offset-2">
                  {rowId}
                </Link>
              </span>
            ))}
          </p>
        )
      })}
      <p>
        Deleting it leaves {references.length === 1 && references[0].rowIds.length === 1 ? 'that' : 'those'} pointing at
        a missing {what}, which the data check rejects. Repoint them first, or delete anyway and fix them after.
      </p>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { IncomingReference } from '../core/schema'
import type { ReactNode } from 'react'
import { appStore } from '../core/store'
import { fileUrl } from '../core/github'
import { effectiveValue, fieldByKey, referencesTo } from '../core/schema'
import { useAppState, useCanEdit, useResolveRef, useRow, useTableSchema } from '../app/hooks'
import { useNavigate } from '../app/router'
import { Button, Card, ErrorNote, Link, Spinner } from './components'
import { rendererFor } from './fields'

/**
 * `extra` is a slot for read-only sections a table wants under its fields — computed views such as a
 * yarn's colour combinations, which are not schema fields and so have no `Display` to render them.
 * It is passed in by the caller rather than looked up here, so `ui/` never imports from `features/`.
 */
export function RecordDetail({ table, id, extra }: { table: string; id: string; extra?: ReactNode }) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const row = useRow(table, id)
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
    await appStore.remove(table, id)
    navigate(`/${table}`, { replace: true })
  }

  return (
    <div className="space-y-4 pb-24">
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
                <Display field={field} value={value} row={row} schema={schema} />
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
 * What a delete would orphan, shown while it waits for "Really delete". Deleting stays allowed — the
 * rows can be repointed afterwards — but a dangling reference fails the deploy's data check, so it
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

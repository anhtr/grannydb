import { useState } from 'react'
import { appStore } from '../core/store'
import { fileUrl } from '../core/github'
import { effectiveValue, fieldByKey } from '../core/schema'
import { useAppState, useCanEdit, useResolveRef, useRow, useTableSchema } from '../app/hooks'
import { useNavigate } from '../app/router'
import { Button, Card, ErrorNote, Link, Spinner } from './components'
import { rendererFor } from './fields'

export function RecordDetail({ table, id }: { table: string; id: string }) {
  const state = useAppState()
  const schema = useTableSchema(table)
  const row = useRow(table, id)
  const canEdit = useCanEdit()
  const navigate = useNavigate()
  const resolve = useResolveRef()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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
                <Display field={field} value={value} />
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

      {canEdit ? (
        <div className="flex gap-3 px-4">
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

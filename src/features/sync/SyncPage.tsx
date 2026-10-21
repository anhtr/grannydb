import { useState } from 'react'
import { appStore } from '../../core/store'
import type { AppState, Change, SyncResult } from '../../core/store'
import { findRow } from '../../core/csv'
import { fieldByKey } from '../../core/schema'
import { commitUrl } from '../../core/github'
import { useAppState } from '../../app/hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Link } from '../../ui/components'

/**
 * One queued change in words: which record, whether it is new, and which fields — by their labels, as
 * the form shows them, rather than the CSV column keys the queue stores.
 */
function describe(change: Change, state: AppState): { record: string; fields: string; link?: string } {
  if (change.op === 'set') return { record: 'Project settings', fields: Object.keys(change.values).join(', ') }
  if (change.op === 'delete') return { record: `Delete ${change.rowId}`, fields: '' }
  const schema = state.snapshot?.schemas.tables[change.table]
  const base = state.snapshot?.tables[change.table]
  const isNew = schema && base ? !findRow(base, schema.idField, change.rowId) : false
  const fields = Object.keys(change.values ?? {})
    .filter((k) => k !== (schema?.idField ?? 'id'))
    .map((k) => (schema ? fieldByKey(schema, k)?.label : undefined) ?? k)
  return {
    record: isNew ? `New ${change.rowId}` : change.rowId,
    fields: fields.join(', '),
    link: `/${change.table}/${change.rowId}`,
  }
}

export function SyncPage() {
  const state = useAppState()
  const [result, setResult] = useState<SyncResult | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const onSync = async () => {
    setResult(await appStore.sync())
  }

  return (
    <div className="space-y-4 px-4 pb-24">
      {!state.token ? (
        <ErrorNote>
          No token saved, so nothing can be pushed. Add one in{' '}
          <Link to="/settings" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </ErrorNote>
      ) : null}

      {!state.queueDurable ? (
        <ErrorNote>
          This browser is not letting the app store data locally, so unsynced edits will be lost if
          you close the tab. Sync now, and check whether site data is blocked (private browsing
          often does this).
        </ErrorNote>
      ) : null}

      {state.syncError ? <ErrorNote>{state.syncError}</ErrorNote> : null}

      {result ? (
        <Card className="p-4 text-sm">
          {result.status === 'committed' ? (
            <p>
              Pushed {result.changeCount} change{result.changeCount === 1 ? '' : 's'} as{' '}
              <a
                href={commitUrl(state.config, result.sha)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-accent underline underline-offset-2"
              >
                {result.sha.slice(0, 7)}
              </a>
              {result.attempts > 1 ? ` (after ${result.attempts} attempts — the branch had moved)` : ''}.
            </p>
          ) : (
            <p>Nothing to write: the repo already matches your edits.</p>
          )}
          {result.issues.length > 0 ? (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              {result.issues.length} validation warning{result.issues.length === 1 ? '' : 's'} in the
              data. The commit still went through; check the list below.
            </p>
          ) : null}
          <ul className="mt-2 space-y-1 text-muted">
            {result.issues.slice(0, 10).map((issue, i) => (
              <li key={i}>
                {issue.table}/{issue.rowId}: {issue.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {state.changes.length === 0 ? (
        <EmptyState
          title="Everything is synced"
          hint="Edits you make are held here until you push them."
        />
      ) : (
        <>
          <Card className="divide-y divide-line overflow-hidden">
            {state.changes.map((change) => {
              const { record, fields, link } = describe(change, state)
              return (
                <div key={change.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {link ? (
                        <Link to={link} className="font-mono underline underline-offset-2">
                          {record}
                        </Link>
                      ) : (
                        <span className="font-mono">{record}</span>
                      )}
                      {fields ? <span className="text-muted"> · {fields}</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      {change.op === 'set' ? `${change.doc}.json` : change.table} · {new Date(change.ts).toLocaleString()}
                    </p>
                  </div>
                  {change.op === 'delete' ? <Badge tone="warn">delete</Badge> : null}
                  <Button variant="ghost" onClick={() => void appStore.discardChange(change.id)}>
                    Discard
                  </Button>
                </div>
              )
            })}
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              className="flex-1"
              disabled={state.syncing || !state.token}
              onClick={() => void onSync()}
            >
              {state.syncing
                ? 'Pushing…'
                : `Sync ${state.changes.length} change${state.changes.length === 1 ? '' : 's'}`}
            </Button>
            {confirmDiscard ? (
              <>
                <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                  Keep
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    void appStore.discardAll()
                    setConfirmDiscard(false)
                  }}
                >
                  Discard all
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
                Discard all
              </Button>
            )}
          </div>

          <p className="text-xs text-muted">
            All of these go up as one commit. If the repo changed in the meantime — an edit on
            another device, or in the GitHub web editor — your changes are replayed on top of it
            rather than overwriting it.
          </p>
        </>
      )}
    </div>
  )
}

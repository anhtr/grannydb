import { useState } from 'react'
import { appStore, AUTO_SYNC_IDLE_MS } from '../../core/store'
import type { AppState, Change, SyncResult } from '../../core/store'
import { findRow } from '../../core/csv'
import { fieldByKey } from '../../core/schema'
import { commitUrl } from '../../core/github'
import { useAppState } from '../../app/hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Link } from '../../ui/components'

/**
 * One queued change in words: which record, whether it is new, and which fields - by their labels, as
 * the form shows them, rather than the CSV column keys the queue stores.
 */
function describe(change: Change, state: AppState): { record: string; fields: string; link?: string } {
  if (change.op === 'set') return { record: 'Project settings', fields: Object.keys(change.values).join(', ') }
  if (change.op === 'delete') return { record: `Delete ${change.rowId}`, fields: '' }
  const schema = state.snapshot?.schemas.tables[change.table]
  const base = state.snapshot?.tables[change.table]
  // The flag where there is one; a change queued before it existed falls back to asking the base.
  const isNew = change.create ?? (schema && base ? !findRow(base, schema.idField, change.rowId) : false)
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

      {state.lastSync?.renumbered?.length ? (
        <Card className="p-4 text-sm">
          <p>The last sync found some ids already taken in the repo, so these new records were saved under the next free id:</p>
          <ul className="mt-2 space-y-1">
            {state.lastSync.renumbered.map((r) => {
              const noun = (state.snapshot?.schemas.tables[r.table]?.labelSingular ?? r.table).toLowerCase()
              return (
                <li key={`${r.table}/${r.from}`}>
                  New {noun} {r.from} is now{' '}
                  <Link to={`/${r.table}/${r.to}`} className="font-mono underline underline-offset-2">
                    {r.to}
                  </Link>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-muted">
            If you wrote any of the old ids down anywhere outside the app, they now refer to a different record.
          </p>
        </Card>
      ) : null}

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
          hint={
            state.prefs.autoSync && state.token
              ? 'Edits you make are held here until they sync, which happens on its own whenever there is a connection.'
              : 'Edits you make are held here until you push them.'
          }
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
            {state.prefs.autoSync && state.token
              ? state.online
                ? `These sync on their own ${AUTO_SYNC_IDLE_MS / 1000} seconds after your last edit, or when you leave the app. `
                : "These sync on their own when you're back online. "
              : null}
            All of these go up as one commit. If the repo changed in the meantime — an edit on
            another device, or in the GitHub web editor — your changes are replayed on top of it
            rather than overwriting it.
          </p>
        </>
      )}
    </div>
  )
}

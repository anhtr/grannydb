import { useState } from 'react'
import { appStore, AUTO_SYNC_IDLE_MS } from '../../core/store'
import { describeChange } from '../../core/store'
import type { AppState, Change, ChangeSummary, SyncResult } from '../../core/store'
import { fieldByKey } from '../../core/schema'
import type { ResolveRef } from '../../core/schema'
import { commitUrl } from '../../core/github'
import { useAppState, useResolveRef } from '../../app/hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Link } from '../../ui/components'

const BLANK = <span className="italic">blank</span>

/** One queued change: which record, and each field it sets as "Label: old → new" (see `describeChange`). */
function ChangeRow({
  change,
  summary,
  confirming,
  onConfirming,
}: {
  change: Change
  summary: ChangeSummary
  confirming: boolean
  onConfirming: (on: boolean) => void
}) {
  const { kind, title, name, lines, link } = summary
  const heading = kind === 'new' ? `New ${title}` : title
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {/* A deleted record has no page to open; everything else links to where it can be seen. */}
          {link ? (
            <Link to={link} className={`underline underline-offset-2 ${kind === 'project' ? '' : 'font-mono'}`}>
              {heading}
            </Link>
          ) : (
            <span className="font-mono">{heading}</span>
          )}
          {name ? <span className="text-muted"> · {name}</span> : null}
          {kind === 'delete' ? (
            <>
              {' '}
              <Badge tone="warn">delete</Badge>
            </>
          ) : null}
        </p>
        {lines.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-sm text-muted">
            {lines.map((line) => (
              <li key={line.label} className="break-words">
                <span className="font-medium">{line.label}:</span>{' '}
                {kind === 'new' ? null : (
                  <>
                    <span className="line-through decoration-muted/60">{line.from === '' ? BLANK : line.from}</span>
                    <span aria-label="changed to"> → </span>
                  </>
                )}
                <span className="text-ink">{line.to === '' ? BLANK : line.to}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-xs text-muted">
          {change.op === 'set' ? `${change.doc}.json` : change.table} · {new Date(change.ts).toLocaleString()}
        </p>
      </div>
      {/* Two taps, like Discard all: a discarded edit is gone, and this button sits where a thumb scrolls. */}
      {confirming ? (
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">
          <Button variant="ghost" onClick={() => onConfirming(false)}>
            Keep
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirming(false)
              void appStore.discardChange(change.id)
            }}
          >
            Discard
          </Button>
        </div>
      ) : (
        <Button variant="ghost" className="shrink-0" onClick={() => onConfirming(true)}>
          Discard
        </Button>
      )}
    </div>
  )
}

function summarise(change: Change, state: AppState, resolve: ResolveRef): ChangeSummary | null {
  if (!state.snapshot) return null
  return describeChange(change, state.snapshot, resolve)
}

/**
 * The validation warnings the last sync left behind, read from `lastSync` rather than from the
 * result of pressing Sync - so they are here after an automatic push too, and still here after a
 * reload, until the next sync replaces them.
 */
function SyncWarnings({ state }: { state: AppState }) {
  const issues = state.lastSync?.issues ?? []
  const total = state.lastSync?.issueCount ?? issues.length
  if (total === 0) return null
  const schemas = state.snapshot?.schemas.tables
  return (
    <Card className="p-4 text-sm">
      <p className="text-amber-700 dark:text-amber-400">
        The last sync went through, but left {total} validation warning{total === 1 ? '' : 's'} in the data:
      </p>
      <ul className="mt-2 space-y-1 text-muted">
        {issues.map((issue, i) => {
          const schema = schemas?.[issue.table]
          const field = issue.field ? ((schema ? fieldByKey(schema, issue.field)?.label : undefined) ?? issue.field) : ''
          const isProject = issue.table === 'project'
          return (
            <li key={i}>
              {isProject ? (
                <Link to="/settings" className="underline underline-offset-2">
                  Project settings
                </Link>
              ) : issue.rowId ? (
                <Link to={`/${issue.table}/${issue.rowId}`} className="font-mono underline underline-offset-2">
                  {issue.rowId}
                </Link>
              ) : (
                <span>{schema?.label ?? issue.table}</span>
              )}
              {field ? ` · ${field}` : ''}: {issue.message}
            </li>
          )
        })}
      </ul>
      {total > issues.length ? (
        <p className="mt-2 text-muted">
          and {total - issues.length} more. <span className="font-mono">npm run validate-data</span> lists them all.
        </p>
      ) : null}
    </Card>
  )
}

export function SyncPage() {
  const state = useAppState()
  const [result, setResult] = useState<SyncResult | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // The id of the one change whose Discard is waiting on a second tap, if any.
  const [confirmingChange, setConfirmingChange] = useState<string | null>(null)
  const resolve = useResolveRef()

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
        </Card>
      ) : null}

      <SyncWarnings state={state} />

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
              const summary = summarise(change, state, resolve)
              if (!summary) return null
              return (
                <ChangeRow
                  key={change.id}
                  change={change}
                  summary={summary}
                  confirming={confirmingChange === change.id}
                  onConfirming={(on) => setConfirmingChange(on ? change.id : null)}
                />
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

import { useEffect } from 'react'
import { appStore } from '../core/store'
import { RecordDetail } from '../ui/RecordDetail'
import { RecordForm } from '../ui/RecordForm'
import { RecordList } from '../ui/RecordList'
import { Button, ErrorNote, Link, PageHeader, Spinner } from '../ui/components'
import { SquaresPage } from '../features/squares/SquaresPage'
import { YarnsPage } from '../features/yarns/YarnsPage'
import { StatsPage } from '../features/stats/StatsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { SyncPage } from '../features/sync/SyncPage'
import { useAppState, useCanEdit } from './hooks'
import { matchRoute, useRoute } from './router'

/**
 * Feature screens that are not just "a table".
 *
 * Table screens are generated from the schema instead, so adding a table to `tables.json` gives it
 * a list, a detail view, an editor and a nav tab with no code change here. `squares` overrides only
 * its list, because a row of colour swatches beats a generic title line.
 */
const FIXED_ROUTES = [
  { pattern: '/stats', title: 'Progress', render: () => <StatsPage /> },
  { pattern: '/settings', title: 'Settings', render: () => <SettingsPage /> },
  { pattern: '/sync', title: 'Pending changes', render: () => <SyncPage /> },
] as const

const TABLE_LIST_OVERRIDES: Record<string, () => React.ReactNode> = {
  squares: () => <SquaresPage />,
  yarns: () => <YarnsPage />,
}

export function App() {
  const state = useAppState()
  const path = useRoute()

  useEffect(() => {
    void appStore.init()
  }, [])

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <Screen path={path} />
      <BottomNav path={path} />
      {state.phase === 'loading' && state.snapshot ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 h-0.5 animate-pulse bg-accent" />
      ) : null}
    </div>
  )
}

function Screen({ path }: { path: string }) {
  const state = useAppState()
  const canEdit = useCanEdit()

  if (path === '/' || path === '') {
    return <Redirect to="/squares" />
  }

  for (const route of FIXED_ROUTES) {
    if (matchRoute(route.pattern, path)) {
      return (
        <main className="flex-1">
          <PageHeader title={route.title} action={<SyncButton />} />
          {route.render()}
        </main>
      )
    }
  }

  if (state.phase === 'loading' && !state.snapshot) {
    return (
      <main className="flex-1">
        <Spinner label="Loading data from GitHub" />
      </main>
    )
  }

  if (state.phase === 'error' && !state.snapshot) {
    return (
      <main className="flex-1 space-y-4 pt-4">
        <ErrorNote>{state.error}</ErrorNote>
        <div className="px-4">
          <Link to="/settings" className="text-accent underline underline-offset-2">
            Check your settings
          </Link>
        </div>
      </main>
    )
  }

  const schemas = state.snapshot?.schemas
  if (!schemas) return <Spinner />

  // Table routes, most specific first.
  const newMatch = matchRoute('/:table/new', path)
  if (newMatch && schemas.tables[newMatch.table]) {
    const schema = schemas.tables[newMatch.table]
    return (
      <main className="flex-1">
        <PageHeader title={`New ${schema.labelSingular.toLowerCase()}`} action={<SyncButton />} />
        <RecordForm table={newMatch.table} />
      </main>
    )
  }

  const editMatch = matchRoute('/:table/:id/edit', path)
  if (editMatch && schemas.tables[editMatch.table]) {
    const schema = schemas.tables[editMatch.table]
    return (
      <main className="flex-1">
        <PageHeader title={`Edit ${editMatch.id}`} subtitle={schema.label} action={<SyncButton />} />
        <RecordForm table={editMatch.table} id={editMatch.id} />
      </main>
    )
  }

  const detailMatch = matchRoute('/:table/:id', path)
  if (detailMatch && schemas.tables[detailMatch.table]) {
    const schema = schemas.tables[detailMatch.table]
    return (
      <main className="flex-1">
        <PageHeader
          title={detailMatch.id}
          subtitle={schema.labelSingular}
          action={<SyncButton />}
        />
        <RecordDetail table={detailMatch.table} id={detailMatch.id} />
      </main>
    )
  }

  const listMatch = matchRoute('/:table', path)
  if (listMatch && schemas.tables[listMatch.table]) {
    const table = listMatch.table
    const schema = schemas.tables[table]
    const override = TABLE_LIST_OVERRIDES[table]
    return (
      <main className="flex-1">
        <PageHeader
          title={schema.label}
          action={
            <div className="flex items-center gap-2">
              <SyncButton />
              {canEdit ? (
                <Link to={`/${table}/new`}>
                  <Button variant="primary" className="px-3">
                    New
                  </Button>
                </Link>
              ) : null}
            </div>
          }
        />
        {override ? override() : <RecordList key={table} table={table} />}
      </main>
    )
  }

  return (
    <main className="flex-1">
      <PageHeader title="Not found" />
      <div className="px-4">
        <Link to="/squares" className="text-accent underline underline-offset-2">
          Back to squares
        </Link>
      </div>
    </main>
  )
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(`#${to}`)
  }, [to])
  return <Spinner />
}

function SyncButton() {
  const { changes, syncing } = useAppState()
  if (changes.length === 0 && !syncing) return null
  return (
    <Link to="/sync">
      <span className="tap-target inline-flex items-center gap-2 rounded-xl bg-accent-soft px-3 text-sm font-medium text-accent">
        {syncing ? 'Syncing…' : `${changes.length} unsynced`}
      </span>
    </Link>
  )
}

function BottomNav({ path }: { path: string }) {
  const state = useAppState()
  const tables = state.snapshot?.schemas.order ?? []

  const items = [
    ...tables
      .filter((table) => !state.snapshot?.schemas.tables[table]?.hideFromNav)
      .map((table) => ({
        to: `/${table}`,
        label: state.snapshot?.schemas.tables[table]?.label ?? table,
        section: table,
      })),
    { to: '/stats', label: 'Progress', section: 'stats' },
    { to: '/settings', label: 'Settings', section: 'settings' },
  ]

  const active = path.split('/').filter(Boolean)[0] ?? ''

  return (
    <nav className="sticky bottom-0 z-30 border-t border-line bg-paper/95 pb-safe backdrop-blur">
      <ul className="mx-auto flex max-w-2xl">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <Link
              to={item.to}
              className={`tap-target flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition ${
                active === item.section ? 'text-accent' : 'text-muted'
              }`}
            >
              <span
                className={`h-1 w-6 rounded-full transition ${
                  active === item.section ? 'bg-accent' : 'bg-transparent'
                }`}
              />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

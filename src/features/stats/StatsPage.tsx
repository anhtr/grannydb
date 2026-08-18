import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { splitList, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useAppState, useLookup, useTable, useTableSchema } from '../../app/hooks'
import { Card, Spinner, Swatch } from '../../ui/components'

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
/** The trailing window "Pace" normally averages over. */
const PACE_WINDOW_WEEKS = 4

function yarnLabel(schema: TableSchema | null, row: CsvRow | undefined, fallbackId: string): string {
  if (!schema || !row) return fallbackId
  return titleFor(schema, row)
}

interface Tally {
  key: string
  label: string
  count: number
  hex?: string
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }}
      />
    </div>
  )
}

function TallyCard({ title, items, note }: { title: string; items: Tally[]; note?: string }) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0)
  return (
    <Card className="p-4">
      <h2 className="font-medium">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <li key={item.key}>
              <div className="flex items-center gap-2 text-sm">
                {item.hex !== undefined ? <Swatch hex={item.hex} size={14} /> : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="tabular-nums text-muted">{item.count}</span>
              </div>
              <div className="mt-1">
                <Bar value={item.count} max={max} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </Card>
  )
}

export function StatsPage() {
  const squares = useTable('squares')
  const schema = useTableSchema('squares')
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const designs = useLookup('designs')
  const projectStartDate = useAppState().prefs.projectStartDate

  const stats = useMemo(() => {
    if (!squares) return null
    const rows = squares.rows
    // "blocked" is the stage after "done" (crocheted, then blocked) rather than a separate
    // property, so both statuses count as finished squares toward the goal.
    const finished = rows.filter((r) => r.status === 'done' || r.status === 'blocked')
    const blocked = rows.filter((r) => r.status === 'blocked')

    const byStatus = new Map<string, number>()
    const byDesign = new Map<string, number>()
    // A square counts once per colour it uses, main or extra, so this measures yarn reach rather
    // than square count. Deduped per square so a colour used twice in one square counts once.
    const byYarn = new Map<string, number>()
    // Main colour only, and only squares still in progress — which skein is actually on the hook
    // right now, as opposed to byYarn's all-time, all-colour reach.
    const byMainYarnInProgress = new Map<string, number>()

    for (const row of rows) {
      byStatus.set(row.status || '(none)', (byStatus.get(row.status || '(none)') ?? 0) + 1)
      byDesign.set(row.design_id || '', (byDesign.get(row.design_id || '') ?? 0) + 1)
      const used = new Set([row.main_yarn ?? '', ...splitList(row.extra_yarns ?? '')])
      used.delete('')
      for (const id of used) byYarn.set(id, (byYarn.get(id) ?? 0) + 1)
      if (row.status === 'in progress' && row.main_yarn) {
        byMainYarnInProgress.set(row.main_yarn, (byMainYarnInProgress.get(row.main_yarn) ?? 0) + 1)
      }
    }

    // Pace over a trailing window, from the dates on finished squares. The window is normally 4
    // weeks, but shrinks to however long the project has actually been running when that is less —
    // otherwise a project in its second week would have its pace divided by 4 anyway and read as a
    // quarter of the real rate.
    const startMs = projectStartDate ? Date.parse(projectStartDate) : NaN
    const elapsedWeeks = Number.isFinite(startMs) ? (Date.now() - startMs) / MS_PER_WEEK : Infinity
    const paceWindowWeeks = Math.min(PACE_WINDOW_WEEKS, Math.max(elapsedWeeks, 1 / 7))
    const cutoff = Date.now() - paceWindowWeeks * MS_PER_WEEK
    const recent = finished.filter((r) => {
      const t = Date.parse(r.date ?? '')
      return Number.isFinite(t) && t >= cutoff
    }).length

    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    return {
      total: rows.length,
      done: finished.length,
      blocked: blocked.length,
      unblocked: finished.length - blocked.length,
      perWeek: recent / paceWindowWeeks,
      paceWindowWeeks,
      byStatus: sortDesc(byStatus),
      byDesign: sortDesc(byDesign),
      byYarn: sortDesc(byYarn),
      byMainYarnInProgress: sortDesc(byMainYarnInProgress),
    }
  }, [squares, projectStartDate])

  if (!stats || !schema) return <Spinner />

  const goal = schema.goal ?? 0
  const remaining = Math.max(0, goal - stats.done)
  const weeksLeft = stats.perWeek > 0 ? Math.ceil(remaining / stats.perWeek) : null

  return (
    <div className="space-y-3 px-4 pb-24">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Finished"
          value={goal > 0 ? `${stats.done} / ${goal}` : String(stats.done)}
          sub={goal > 0 ? `${remaining} to go` : undefined}
        />
        <Stat label="Blocked" value={`${stats.blocked}`} sub={`${stats.unblocked} still to block`} />
        <Stat
          label="Pace"
          value={stats.perWeek.toFixed(1)}
          sub={`squares per week, last ${
            stats.paceWindowWeeks >= PACE_WINDOW_WEEKS
              ? `${PACE_WINDOW_WEEKS} weeks`
              : `${stats.paceWindowWeeks.toFixed(1)} week${stats.paceWindowWeeks >= 1.05 ? 's' : ''}`
          }`}
        />
        <Stat
          label="At this rate"
          value={weeksLeft === null ? '—' : `${weeksLeft}w`}
          sub={weeksLeft === null ? 'no recent squares' : 'until the last square'}
        />
      </div>

      <TallyCard
        title="By status"
        items={stats.byStatus.map(([key, count]) => ({ key, label: key, count }))}
      />

      <TallyCard
        title="In progress, by main colour"
        note="Only squares currently in progress, and only the main colour."
        items={stats.byMainYarnInProgress.map(([key, count]) => ({
          key,
          label: yarnLabel(yarnSchema, yarns.get(key), key),
          hex: yarns.get(key)?.hex ?? '',
          count,
        }))}
      />

      <TallyCard
        title="By colour"
        note="Counts every square a colour appears in, main or extra."
        items={stats.byYarn.map(([key, count]) => ({
          key,
          label: yarnLabel(yarnSchema, yarns.get(key), key),
          hex: yarns.get(key)?.hex ?? '',
          count,
        }))}
      />

      <TallyCard
        title="By design"
        items={stats.byDesign.map(([key, count]) => ({
          key: key || '(none)',
          label: designs.get(key)?.name ?? '(no design)',
          count,
        }))}
      />
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CsvRow } from '../../core/csv'
import { effectiveGoal } from '../../core/prefs'
import { splitList, squareConstructionInsights, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useAppState, useLookup, useResolveRef, useTable, useTableSchema } from '../../app/hooks'
import { Card, Link, Spinner, Swatch } from '../../ui/components'

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
    <Card className="p-3">
      <h2 className="font-medium">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
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

/**
 * Same tally data as `TallyCard`, but collapsible: expanded shows the usual bar-chart list, collapsed
 * shows whatever compact summary `renderCollapsed` builds instead — a colour-chip row or a
 * comma-separated line, cheap enough to always render so toggling never re-fetches anything.
 */
function CollapsibleTallyCard({
  title,
  note,
  items,
  collapsed,
  onToggle,
  renderCollapsed,
}: {
  title: string
  note?: string
  items: Tally[]
  collapsed: boolean
  onToggle: () => void
  renderCollapsed: (items: Tally[]) => ReactNode
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0)
  return (
    <Card className="p-3">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={onToggle}>
        <span>
          <span className="block font-medium">{title}</span>
          {note ? <span className="mt-0.5 block text-xs text-muted">{note}</span> : null}
        </span>
        <span className="tap-target shrink-0 text-xs text-accent">{collapsed ? 'Show all' : 'Collapse'}</span>
      </button>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
      ) : collapsed ? (
        renderCollapsed(items)
      ) : (
        <ul className="mt-2 space-y-2">
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

/** Collapsed view for a colour tally: just the swatch and the count, gapped out in a row — the name
 * is what the expanded list is for. */
function collapsedColourChips(items: Tally[]): ReactNode {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5 text-sm">
          <Swatch hex={item.hex} size={14} />
          <span className="tabular-nums text-muted">{item.count}</span>
        </span>
      ))}
    </div>
  )
}

/** Collapsed view for the by-design tally: only designs with more than one square are worth naming
 * at a glance — a design with exactly one is every other list's default anyway. */
function collapsedDesignSummary(items: Tally[]): ReactNode {
  const notable = items.filter((i) => i.count > 1)
  return (
    <p className="mt-2 text-sm text-muted">
      {notable.length > 0 ? notable.map((i) => `${i.label} (${i.count})`).join(', ') : 'None with more than one square yet.'}
    </p>
  )
}

interface ColourImbalance {
  key: string
  label: string
  hex?: string
  /** How many more squares of this colour would be needed in each short construction, to match the fullest one. */
  deficits: { construction: string; count: number }[]
}

function ImbalanceCard({ title, note, items }: { title: string; note?: string; items: ColourImbalance[] }) {
  return (
    <Card className="p-3">
      <h2 className="font-medium">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              {item.hex !== undefined ? <Swatch hex={item.hex} size={14} /> : null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-muted">
                {item.deficits.map((d) => `${d.count} short in ${d.construction}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

interface Gap {
  id: string
  date: string
}

/**
 * A square missing its main colour or design silently drops out of every colour/construction tally
 * above (they all key off `main_yarn`/`design_id`) rather than showing up as an obvious zero, which
 * is exactly what made the colour-imbalance card go quiet instead of flagging a real gap. This card
 * lists the rows themselves — every status, not just finished — so the gap is something to click
 * through and fix rather than a mystery to debug from the other cards' totals.
 */
function GapsCard({ title, items }: { title: string; items: Gap[] }) {
  return (
    <Card className="p-3">
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None — nice.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/squares/${item.id}`}
                className="flex items-center justify-between rounded-lg px-1 py-0.5 text-sm text-accent hover:underline"
              >
                <span className="font-mono">{item.id}</span>
                {item.date ? <span className="text-xs text-muted">{item.date}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Stat({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
      {extra}
    </Card>
  )
}

/** Collapsed by default — these three are the biggest cards on the page, and the summary line is
 * usually all a glance needs. */
const INITIAL_COLLAPSED = { byMainColour: true, byColour: true, byDesign: true }

export function StatsPage() {
  const squares = useTable('squares')
  const schema = useTableSchema('squares')
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const designs = useLookup('designs')
  const prefs = useAppState().prefs
  const resolve = useResolveRef()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(INITIAL_COLLAPSED)
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const stats = useMemo(() => {
    if (!squares || !schema) return null
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
    // Main colour only, and only squares actually finished (done or blocked) — which colours the
    // finished pile is made of, as opposed to byYarn's all-status, main-plus-extra reach.
    const byMainYarnFinished = new Map<string, number>()

    for (const row of rows) {
      byStatus.set(row.status || '(none)', (byStatus.get(row.status || '(none)') ?? 0) + 1)
      byDesign.set(row.design_id || '', (byDesign.get(row.design_id || '') ?? 0) + 1)
      const used = new Set([row.main_yarn ?? '', ...splitList(row.extra_yarns ?? '')])
      used.delete('')
      for (const id of used) byYarn.set(id, (byYarn.get(id) ?? 0) + 1)
      if ((row.status === 'done' || row.status === 'blocked') && row.main_yarn) {
        byMainYarnFinished.set(row.main_yarn, (byMainYarnFinished.get(row.main_yarn) ?? 0) + 1)
      }
    }

    // Construction tallies, imbalance and the missing-colour/design gaps are one aggregation pass
    // shared with the squares list's progress header — see `squareConstructionInsights`.
    const insights = squareConstructionInsights(schema, squares, resolve)
    const colourImbalances: ColourImbalance[] = insights.imbalancedColours
      .map(({ yarnId, deficits }) => ({
        key: yarnId,
        label: yarnLabel(yarnSchema, yarns.get(yarnId), yarnId),
        hex: yarns.get(yarnId)?.hex ?? '',
        deficits,
      }))
      .sort(
        (a, b) =>
          b.deficits.reduce((sum, d) => sum + d.count, 0) - a.deficits.reduce((sum, d) => sum + d.count, 0) ||
          a.label.localeCompare(b.label),
      )

    // Pace over a trailing window, from the dates on finished squares. The window is normally 4
    // weeks, but shrinks to however long the project has actually been running when that is less —
    // otherwise a project in its second week would have its pace divided by 4 anyway and read as a
    // quarter of the real rate.
    const startMs = prefs.projectStartDate ? Date.parse(prefs.projectStartDate) : NaN
    const elapsedWeeks = Number.isFinite(startMs) ? (Date.now() - startMs) / MS_PER_WEEK : Infinity
    const paceWindowWeeks = Math.min(PACE_WINDOW_WEEKS, Math.max(elapsedWeeks, 1 / 7))
    const cutoff = Date.now() - paceWindowWeeks * MS_PER_WEEK
    const recent = finished.filter((r) => {
      const t = Date.parse(r.date ?? '')
      return Number.isFinite(t) && t >= cutoff
    }).length

    // Lifetime pace, for comparison against the trailing window above — null when there's no
    // project start date to measure the "since when" from.
    const overallPerWeek = Number.isFinite(startMs) && elapsedWeeks > 0 ? finished.length / elapsedWeeks : null

    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    return {
      total: rows.length,
      done: finished.length,
      blocked: blocked.length,
      unblocked: finished.length - blocked.length,
      perWeek: recent / paceWindowWeeks,
      overallPerWeek,
      paceWindowWeeks,
      byStatus: sortDesc(byStatus),
      byDesign: sortDesc(byDesign),
      byYarn: sortDesc(byYarn),
      byMainYarnFinished: sortDesc(byMainYarnFinished),
      byConstructionFinished: insights.byConstructionFinished,
      colourImbalances,
      missingMainYarn: insights.missingMainYarn.map((r): Gap => ({ id: r.id ?? '', date: r.date ?? '' })),
      missingDesign: insights.missingDesign.map((r): Gap => ({ id: r.id ?? '', date: r.date ?? '' })),
    }
  }, [squares, schema, prefs, resolve, yarns, yarnSchema])

  if (!stats || !schema) return <Spinner />

  const goal = effectiveGoal(schema, prefs)
  const remaining = Math.max(0, goal - stats.done)
  const weeksLeft = stats.perWeek > 0 ? Math.ceil(remaining / stats.perWeek) : null
  const completionDate = weeksLeft !== null ? new Date(Date.now() + weeksLeft * MS_PER_WEEK) : null

  return (
    <div className="space-y-2 px-4 pb-24">
      <div className="grid grid-cols-2 gap-2">
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
          extra={
            stats.overallPerWeek !== null ? (
              <p className="text-[10px] text-muted">{stats.overallPerWeek.toFixed(1)}/week overall</p>
            ) : null
          }
        />
        <Stat
          label="At this rate"
          value={weeksLeft === null ? '—' : `${weeksLeft}w`}
          sub={weeksLeft === null ? 'no recent squares' : 'until the last square'}
          extra={
            completionDate ? (
              <p className="text-[11px] italic text-muted">
                ({completionDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })})
              </p>
            ) : null
          }
        />
      </div>

      <TallyCard
        title="By status"
        items={stats.byStatus.map(([key, count]) => ({ key, label: key, count }))}
      />

      <CollapsibleTallyCard
        title="Finished, by main colour"
        note="Only finished squares (done or blocked), and only the main colour."
        items={stats.byMainYarnFinished.map(([key, count]) => ({
          key,
          label: yarnLabel(yarnSchema, yarns.get(key), key),
          hex: yarns.get(key)?.hex ?? '',
          count,
        }))}
        collapsed={collapsed.byMainColour}
        onToggle={() => toggle('byMainColour')}
        renderCollapsed={collapsedColourChips}
      />

      <CollapsibleTallyCard
        title="By colour"
        note="Counts every square a colour appears in, main or extra."
        items={stats.byYarn.map(([key, count]) => ({
          key,
          label: yarnLabel(yarnSchema, yarns.get(key), key),
          hex: yarns.get(key)?.hex ?? '',
          count,
        }))}
        collapsed={collapsed.byColour}
        onToggle={() => toggle('byColour')}
        renderCollapsed={collapsedColourChips}
      />

      <CollapsibleTallyCard
        title="By design"
        items={stats.byDesign.map(([key, count]) => ({
          key: key || '(none)',
          label: designs.get(key)?.name ?? '(no design)',
          count,
        }))}
        collapsed={collapsed.byDesign}
        onToggle={() => toggle('byDesign')}
        renderCollapsed={collapsedDesignSummary}
      />

      <TallyCard
        title="Finished, by construction"
        note="Only finished squares (done or blocked). A square with no construction of its own counts by its design's."
        items={stats.byConstructionFinished.map((c) => ({ key: c.construction, label: c.construction, count: c.count }))}
      />

      <ImbalanceCard
        title="Colour imbalance by construction"
        note="Main colours where finished squares favour one construction over another, and by how much."
        items={stats.colourImbalances}
      />

      <GapsCard title="Missing main colour" items={stats.missingMainYarn} />
      <GapsCard title="Missing design" items={stats.missingDesign} />
    </div>
  )
}

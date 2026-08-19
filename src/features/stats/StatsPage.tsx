import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { effectiveGoal } from '../../core/prefs'
import { effectiveValue, fieldByKey, splitList, titleFor } from '../../core/schema'
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

interface ColourImbalance {
  key: string
  label: string
  hex?: string
  /** How many more squares of this colour would be needed in each short construction, to match the fullest one. */
  deficits: { construction: string; count: number }[]
}

function ImbalanceCard({ title, note, items }: { title: string; note?: string; items: ColourImbalance[] }) {
  return (
    <Card className="p-4">
      <h2 className="font-medium">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
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
    <Card className="p-4">
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">None — nice.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
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
  const prefs = useAppState().prefs
  const resolve = useResolveRef()

  const stats = useMemo(() => {
    if (!squares || !schema) return null
    const rows = squares.rows
    // "blocked" is the stage after "done" (crocheted, then blocked) rather than a separate
    // property, so both statuses count as finished squares toward the goal.
    const finished = rows.filter((r) => r.status === 'done' || r.status === 'blocked')
    const blocked = rows.filter((r) => r.status === 'blocked')

    // A square's own `construction_type` cell is usually blank and means "same as its design" (see
    // ADR 0016), so every construction tally below reads the *effective* value rather than the raw
    // column — otherwise squares that inherit their construction would vanish from these counts.
    const constructionField = fieldByKey(schema, 'construction_type')
    const constructionOf = (row: CsvRow): string =>
      constructionField ? effectiveValue(schema, constructionField, row, resolve).value : ''

    const byStatus = new Map<string, number>()
    const byDesign = new Map<string, number>()
    // A square counts once per colour it uses, main or extra, so this measures yarn reach rather
    // than square count. Deduped per square so a colour used twice in one square counts once.
    const byYarn = new Map<string, number>()
    // Main colour only, and only squares actually finished (done or blocked) — which colours the
    // finished pile is made of, as opposed to byYarn's all-status, main-plus-extra reach.
    const byMainYarnFinished = new Map<string, number>()
    // Finished squares only, tallied by their effective construction type.
    const byConstructionFinished = new Map<string, number>()
    // Finished squares' main colour, tallied per construction type, so a colour's counts can be
    // compared across constructions to spot ones that are lopsided.
    const byYarnConstructionFinished = new Map<string, Map<string, number>>()

    for (const row of rows) {
      byStatus.set(row.status || '(none)', (byStatus.get(row.status || '(none)') ?? 0) + 1)
      byDesign.set(row.design_id || '', (byDesign.get(row.design_id || '') ?? 0) + 1)
      const used = new Set([row.main_yarn ?? '', ...splitList(row.extra_yarns ?? '')])
      used.delete('')
      for (const id of used) byYarn.set(id, (byYarn.get(id) ?? 0) + 1)
      if (row.status === 'done' || row.status === 'blocked') {
        const construction = constructionOf(row)
        if (row.main_yarn) {
          byMainYarnFinished.set(row.main_yarn, (byMainYarnFinished.get(row.main_yarn) ?? 0) + 1)
        }
        if (construction) {
          byConstructionFinished.set(construction, (byConstructionFinished.get(construction) ?? 0) + 1)
          if (row.main_yarn) {
            const byConstruction = byYarnConstructionFinished.get(row.main_yarn) ?? new Map<string, number>()
            byConstruction.set(construction, (byConstruction.get(construction) ?? 0) + 1)
            byYarnConstructionFinished.set(row.main_yarn, byConstruction)
          }
        }
      }
    }

    // A colour is "imbalanced" when it has more finished squares in one construction than another —
    // the gap is a deficit relative to whichever construction that colour is furthest along in.
    // Only compares constructions the schema actually defines, not just ones seen in the data, so a
    // colour with zero squares of a construction still shows the full gap rather than being skipped.
    const constructionTypes = constructionField?.options ?? []
    const colourImbalances: ColourImbalance[] = []
    for (const [yarnId, counts] of byYarnConstructionFinished) {
      const max = Math.max(...constructionTypes.map((c) => counts.get(c) ?? 0))
      const deficits = constructionTypes
        .map((construction) => ({ construction, count: max - (counts.get(construction) ?? 0) }))
        .filter((d) => d.count > 0)
      if (deficits.length === 0) continue
      colourImbalances.push({
        key: yarnId,
        label: yarnLabel(yarnSchema, yarns.get(yarnId), yarnId),
        hex: yarns.get(yarnId)?.hex ?? '',
        deficits,
      })
    }
    colourImbalances.sort(
      (a, b) =>
        b.deficits.reduce((sum, d) => sum + d.count, 0) - a.deficits.reduce((sum, d) => sum + d.count, 0) ||
        a.label.localeCompare(b.label),
    )

    // Every status, not just finished — a gap is worth fixing whether or not the square is done yet.
    const toGap = (r: CsvRow): Gap => ({ id: r.id ?? '', date: r.date ?? '' })
    const missingMainYarn = rows.filter((r) => !r.main_yarn).map(toGap)
    const missingDesign = rows.filter((r) => !r.design_id).map(toGap)

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
      byMainYarnFinished: sortDesc(byMainYarnFinished),
      byConstructionFinished: sortDesc(byConstructionFinished),
      colourImbalances,
      missingMainYarn,
      missingDesign,
    }
  }, [squares, schema, prefs, resolve, yarns, yarnSchema])

  if (!stats || !schema) return <Spinner />

  const goal = effectiveGoal(schema, prefs)
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
        title="Finished, by main colour"
        note="Only finished squares (done or blocked), and only the main colour."
        items={stats.byMainYarnFinished.map(([key, count]) => ({
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

      <TallyCard
        title="Finished, by construction"
        note="Only finished squares (done or blocked). A square with no construction of its own counts by its design's."
        items={stats.byConstructionFinished.map(([key, count]) => ({ key, label: key, count }))}
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

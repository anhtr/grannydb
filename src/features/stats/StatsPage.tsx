import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { CsvRow } from '../../core/csv'
import { effectiveGoal } from '../../core/prefs'
import { fieldByKey, splitList, squareConstructionInsights, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useAppState, useLookup, useResolveRef, useTable, useTableSchema } from '../../app/hooks'
import { Card, DonutChart, Link, Spinner, Swatch } from '../../ui/components'
import type { DonutSlice } from '../../ui/components'
import { statusMark } from '../../ui/status'

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
  /** Bar fill for this row. Defaults to the accent; set where the row belongs to a scale whose
   * colours the reader has already met somewhere else on the card (see `StatusStackCard`). */
  color?: string
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full"
        style={{ width: `${max === 0 ? 0 : (value / max) * 100}%`, background: color ?? 'var(--color-accent)' }}
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
                <Bar value={item.count} max={max} color={item.color} />
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

interface StatusTally {
  key: string
  label: string
  count: number
  color: string
}

/**
 * How wide the stacked bar is on the narrowest screen this app is used on — a 320px viewport less the
 * page and card padding. Only used until the bar has actually been measured, so the labels on the
 * first paint are the ones that would fit on any phone, and never more.
 */
const NARROWEST_BAR_PX = 260
/** Rough glyph width of the label type (10px sans). Only ever used to decide whether a label fits,
 * never to position one, so an approximation is enough. */
const LABEL_CHAR_PX = 5.5
/** Clear space either side of a label, so two neighbouring labels don't read as one string. */
const LABEL_PAD_PX = 8

/** Whether `text` fits above a segment holding `share` of a bar `barPx` wide. */
function labelFits(text: string, share: number, barPx: number): boolean {
  return share * barPx >= text.length * LABEL_CHAR_PX + LABEL_PAD_PX
}

/**
 * The rendered width of an element, kept current as the screen changes.
 *
 * Which labels fit above the status bar is the one thing on this page that a stylesheet cannot decide
 * and an estimate gets wrong in both directions: assume a narrow screen and a 390px phone loses
 * labels it had room for; assume a wide one and a 320px phone clips them. So measure. Before the
 * first measurement — and under jsdom, which has no `ResizeObserver` — the caller falls back to the
 * narrowest-phone estimate, which is never *too* generous.
 */
function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * How much of a segment's label fits above it, given its share of the bar — the name and the count on
 * one line, the two stacked, the count alone, or nothing at all.
 *
 * A label is never clipped or truncated to make it fit: cropping the first characters of a status
 * name is worse than leaving that segment to its tooltip and the expanded list. Stacking is what
 * keeps the *names* on a bar drawn to the goal, where a status is a narrow slice of a mostly-empty
 * blanket — "blocked" on its own line needs half the width of "blocked 66".
 */
type LabelForm = 'full' | 'stacked' | 'count' | 'none'

function labelForm(label: string, count: number, share: number, barPx: number): LabelForm {
  if (labelFits(`${label} ${count}`, share, barPx)) return 'full'
  if (labelFits(label, share, barPx)) return 'stacked'
  if (labelFits(String(count), share, barPx)) return 'count'
  return 'none'
}

/** Each segment's label form, levelled down to the narrowest one any of them needs: once one segment
 * has to stack, they all do, so every name sits on one line and every number on the next instead of
 * the row zig-zagging between the two. */
function uniformLabelForms(segments: StatusTally[], shares: number[], barPx: number): LabelForm[] {
  const forms = segments.map((segment, i) => labelForm(segment.label, segment.count, shares[i], barPx))
  const stacking = forms.includes('stacked')
  return stacking ? forms.map((form) => (form === 'full' ? 'stacked' : form)) : forms
}

/**
 * Squares by status as one part-to-whole bar, measured against the *goal* rather than against the
 * squares made so far: the full width is all 400, each segment is one status, and what is left over
 * is the blanket that doesn't exist yet, in grey. This replaced a bar-per-status list, which answered
 * "how many are blocked" but not "how much of the blanket is that" — the question the card is
 * actually for, and one a reader could only answer by mentally summing four bars drawn against the
 * largest one. Scaling to the goal is what makes the two readings one picture: composition and
 * progress at the same time, and a bar that visibly fills up over the life of the project instead of
 * always being full.
 *
 * Statuses run most-advanced first so the coloured part grows from the left. Each segment is labelled
 * above with its status and count where the label fits (see `labelFits`); a segment too thin for one
 * keeps its hover tooltip, and expanding the card gives every status its own row and bar — the old
 * view, kept for the comparison a single stacked bar is bad at, reading two middling segments against
 * each other. Both views take their colours from `ui/status.ts`, the same place a Squares row's badge
 * takes its tone, so a status is one colour wherever it is drawn.
 */
function StatusStackCard({
  title,
  items,
  goal,
  collapsed,
  onToggle,
}: {
  title: string
  items: StatusTally[]
  /** Squares the project is aiming at. The bar is drawn to this; 0 (no goal) falls back to the
   * squares recorded, where the bar is simply always full. */
  goal: number
  collapsed: boolean
  onToggle: () => void
}) {
  const counted = items.reduce((sum, i) => sum + i.count, 0)
  const max = items.reduce((m, i) => Math.max(m, i.count), 0)
  // Past the goal there is nothing left to go, and the bar is all statuses again.
  const toGo = Math.max(0, goal - counted)
  const total = counted + toGo
  const segments: StatusTally[] = toGo > 0 ? [...items, { key: '__togo', label: 'to go', count: toGo, color: 'var(--color-line)' }] : items
  const shares = segments.map((segment) => (total === 0 ? 0 : segment.count / total))
  const [barRef, barWidth] = useMeasuredWidth<HTMLDivElement>()
  const forms = uniformLabelForms(segments, shares, barWidth || NARROWEST_BAR_PX)
  return (
    <Card className="p-3">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={onToggle}>
        <span>
          <span className="block font-medium">{title}</span>
          {goal > 0 ? <span className="mt-0.5 block text-xs text-muted">The whole bar is the {goal}-square goal.</span> : null}
        </span>
        <span className="tap-target shrink-0 text-xs text-accent">{collapsed ? 'Show all' : 'Collapse'}</span>
      </button>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <>
          <div className="mt-2 flex gap-[2px]">
            {segments.map((item, i) => (
              <span
                key={item.key}
                className="min-w-0 whitespace-nowrap text-[10px] leading-4"
                style={{ flexBasis: `${shares[i] * 100}%` }}
              >
                {forms[i] !== 'count' && forms[i] !== 'none' ? <span className="text-muted">{item.label}</span> : null}
                {forms[i] === 'full' ? ' ' : null}
                {forms[i] === 'stacked' ? <br /> : null}
                {forms[i] !== 'none' ? <span className="font-medium tabular-nums">{item.count}</span> : null}
              </span>
            ))}
          </div>
          {/* The segments and their labels are two rows of the same proportions — same flex basis,
              same 2px surface gap — so a label always sits over the segment it names without either
              row needing to know the bar's pixel width. */}
          <div
            ref={barRef}
            className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
            role="img"
            aria-label={`${counted} of ${total} squares: ${segments.map((i) => `${i.label} ${i.count}`).join(', ')}`}
          >
            {segments.map((item, i) => (
              <span
                key={item.key}
                className="block"
                // A single square out of hundreds is a sliver a fraction of a pixel wide; the floor
                // keeps it visible, and flex shrinks the rest to pay for it.
                style={{ flexBasis: `${shares[i] * 100}%`, minWidth: 3, background: item.color }}
                title={`${item.label}: ${item.count} of ${total} (${Math.round(shares[i] * 100)}%)`}
              />
            ))}
          </div>
          {collapsed ? null : (
            <ul className="mt-3 space-y-2">
              {items.map((item) => (
                <li key={item.key}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="tabular-nums text-muted">{item.count}</span>
                  </div>
                  <div className="mt-1">
                    <Bar value={item.count} max={max} color={item.color} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

interface SourceTally {
  key: string
  label: string
  squares: number
  designs: number
}

/** The categorical chart palette's five fixed slots (`styles.css`), in order. A source past the cap
 * folds into a shared muted "Other" slice rather than cycling past it — see `DonutChart`. */
const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

/** The colour a source's row dot and donut slice share, by its rank in `items` (already sorted
 * squares-desc) — a source past the palette's five slots reads as "Other" everywhere alike. */
function sourceChartColor(index: number): string {
  return index < CHART_COLORS.length ? CHART_COLORS[index] : 'var(--color-muted)'
}

/** Squares-by-source as donut slices: one per source within the palette's five slots, the rest
 * summed into a single "Other" so the chart never cycles past its fixed hues (see
 * `references/anti-patterns.md` in the dataviz skill — past a handful of slices a donut stops being
 * readable at a glance anyway). */
function sourceDonutSlices(items: SourceTally[]): DonutSlice[] {
  const top = items.slice(0, CHART_COLORS.length)
  const rest = items.slice(CHART_COLORS.length)
  const slices = top.map((item, i) => ({ key: item.key, label: item.label, value: item.squares, color: sourceChartColor(i) }))
  const otherSquares = rest.reduce((sum, item) => sum + item.squares, 0)
  if (otherSquares > 0) slices.push({ key: '__other', label: 'Other', value: otherSquares, color: 'var(--color-muted)' })
  return slices
}

/**
 * Two counts per source rather than one — squares made and unique designs drawn on — so a single box
 * answers both "how much have I used this source" and "how much of it have I actually tried", which a
 * single tally couldn't distinguish (a source with one design used ten times looks identical to ten
 * designs used once under a squares-only count). Collapsed drops straight to just the two numbers per
 * source, per the owner's steer that they're self-explanatory without a legend. Expanded keeps that
 * same list rather than switching to a bar-per-source view — which turned out to read as more
 * detailed without actually being more useful — and instead adds a donut of each source's share of
 * squares, capped at a handful of slices (see `sourceDonutSlices`) with a matching colour dot and
 * percentage on each row so the chart and the list read as one system, not two separate views of the
 * same data.
 */
function SourceStatsCard({
  title,
  items,
  collapsed,
  onToggle,
}: {
  title: string
  items: SourceTally[]
  collapsed: boolean
  onToggle: () => void
}) {
  const totalSquares = items.reduce((sum, i) => sum + i.squares, 0)
  const showChart = !collapsed && items.length >= 3
  return (
    <Card className="p-3">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={onToggle}>
        <span className="font-medium">{title}</span>
        <span className="tap-target shrink-0 text-xs text-accent">{collapsed ? 'Show all' : 'Collapse'}</span>
      </button>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <>
          {showChart ? (
            <div className="mt-3 flex justify-center">
              <DonutChart
                data={sourceDonutSlices(items)}
                centerLabel={String(totalSquares)}
                centerSub={totalSquares === 1 ? 'square' : 'squares'}
              />
            </div>
          ) : null}
          <ul className="mt-2 space-y-1.5">
            {items.map((item, i) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                {collapsed ? null : (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: sourceChartColor(i) }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {collapsed ? null : (
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {totalSquares > 0 ? Math.round((item.squares / totalSquares) * 100) : 0}%
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-muted">
                  {item.squares} / {item.designs}
                </span>
              </li>
            ))}
          </ul>
        </>
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

/** Only rendered by the caller when `items` is non-empty — see the "only show up when there's
 * something to display" cards on `StatsPage`. */
function ImbalanceCard({ title, note, items }: { title: string; note?: string; items: ColourImbalance[] }) {
  return (
    <Card className="p-3">
      <h2 className="font-medium">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
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
 * through and fix rather than a mystery to debug from the other cards' totals. Only rendered by the
 * caller when `items` is non-empty — see the "only show up when there's something to display" cards
 * on `StatsPage`.
 */
function GapsCard({ title, items }: { title: string; items: Gap[] }) {
  return (
    <Card className="p-3">
      <h2 className="font-medium">{title}</h2>
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

/** Collapsed by default — these are the biggest cards on the page, and the summary (a line, a chip
 * row, or "By status"'s stacked bar) is usually all a glance needs. */
const INITIAL_COLLAPSED = { byStatus: true, byMainColour: true, byColour: true, byDesign: true, bySource: true }

export function StatsPage() {
  const squares = useTable('squares')
  const schema = useTableSchema('squares')
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const designs = useLookup('designs')
  const sources = useLookup('sources')
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

    // Squares per source, and how many distinct designs from that source have at least one square —
    // the second number is what tells "one design worked ten times" apart from "ten designs tried
    // once", which the squares count alone can't. Both hop through the square's design to reach its
    // source, so a square whose design (or a design without a source) is missing contributes to
    // neither — it's already counted by `missingDesign`/an equivalent gap, not silently folded in here.
    const squaresBySource = new Map<string, number>()
    const designsBySource = new Map<string, Set<string>>()
    for (const row of rows) {
      const sourceId = designs.get(row.design_id ?? '')?.source
      if (!sourceId) continue
      squaresBySource.set(sourceId, (squaresBySource.get(sourceId) ?? 0) + 1)
      const seen = designsBySource.get(sourceId) ?? new Set<string>()
      seen.add(row.design_id ?? '')
      designsBySource.set(sourceId, seen)
    }
    const bySource: SourceTally[] = [...squaresBySource.entries()]
      .map(([sourceId, squareCount]) => ({
        key: sourceId,
        label: sources.get(sourceId)?.name ?? sourceId,
        squares: squareCount,
        designs: designsBySource.get(sourceId)?.size ?? 0,
      }))
      .sort((a, b) => b.squares - a.squares || a.label.localeCompare(b.label))

    // Construction tallies, imbalance and the missing-colour/design gaps are computed in one
    // aggregation pass rather than each inline here — see `squareConstructionInsights`.
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

    // Statuses in the schema's own order — the workflow order — reversed, so the stacked bar runs
    // most-advanced first and fills from the left as squares progress. A status the schema doesn't
    // list (a hand-edited CSV can hold one, and a blank status reads as "(none)") is appended after
    // them, count-desc, and takes the muted fill `statusMark` gives an unknown status. Statuses with
    // no squares are dropped rather than drawn as a zero-width segment and an empty row.
    const statusOptions = fieldByKey(schema, 'status')?.options ?? []
    const byStatusOrdered: StatusTally[] = statusOptions
      .map((option) => ({
        key: option,
        label: option,
        count: byStatus.get(option) ?? 0,
        color: statusMark(option),
      }))
      .reverse()
      .concat(
        sortDesc(byStatus)
          .filter(([key]) => !statusOptions.includes(key))
          .map(([key, count]) => ({ key, label: key, count, color: statusMark(key) })),
      )
      .filter((status) => status.count > 0)

    return {
      total: rows.length,
      done: finished.length,
      blocked: blocked.length,
      unblocked: finished.length - blocked.length,
      perWeek: recent / paceWindowWeeks,
      overallPerWeek,
      paceWindowWeeks,
      byStatus: byStatusOrdered,
      byDesign: sortDesc(byDesign),
      byYarn: sortDesc(byYarn),
      byMainYarnFinished: sortDesc(byMainYarnFinished),
      bySource,
      byConstructionFinished: insights.byConstructionFinished,
      colourImbalances,
      missingMainYarn: insights.missingMainYarn.map((r): Gap => ({ id: r.id ?? '', date: r.date ?? '' })),
      missingDesign: insights.missingDesign.map((r): Gap => ({ id: r.id ?? '', date: r.date ?? '' })),
    }
  }, [squares, schema, prefs, resolve, yarns, yarnSchema, designs, sources])

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

      <StatusStackCard
        title="By status"
        items={stats.byStatus}
        goal={goal}
        collapsed={collapsed.byStatus}
        onToggle={() => toggle('byStatus')}
      />

      <TallyCard
        title="Finished, by construction"
        note="Only finished squares (done or blocked). A square with no construction of its own counts by its design's."
        items={stats.byConstructionFinished.map((c) => ({ key: c.construction, label: c.construction, count: c.count }))}
      />

      {stats.colourImbalances.length > 0 ? (
        <ImbalanceCard
          title="Colour imbalance by construction"
          note="Main colours where finished squares favour one construction over another, and by how much."
          items={stats.colourImbalances}
        />
      ) : null}

      {stats.missingMainYarn.length > 0 ? <GapsCard title="Missing main colour" items={stats.missingMainYarn} /> : null}
      {stats.missingDesign.length > 0 ? <GapsCard title="Missing design" items={stats.missingDesign} /> : null}

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

      <SourceStatsCard
        title="By source"
        items={stats.bySource}
        collapsed={collapsed.bySource}
        onToggle={() => toggle('bySource')}
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
    </div>
  )
}

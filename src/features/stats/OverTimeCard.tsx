import { useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { WEEKDAYS, dayLabel, weekdayIndex } from '../../core/date'
import { DAILY_AVERAGE_DAYS, WEEKLY_AVERAGE_WEEKS } from '../../core/timeline'
import type { SquaresOverTime } from '../../core/timeline'
import { Card } from '../../ui/components'
import { useMeasuredWidth } from '../../ui/useMeasuredWidth'

/** Plot width on the narrowest phone, used until the card has been measured — see `useMeasuredWidth`. */
const NARROWEST_CHART_PX = 290
const CHART_HEIGHT = 128
/** Room for the y-axis labels on the left and the date labels underneath. */
const PAD = { top: 6, right: 4, bottom: 18, left: 24 }
/** Rough width an axis date label ("18 Oct") needs, gap included. Only decides how many to draw. */
const X_LABEL_PX = 44
/** Columns are never fatter than this, however few there are — the leftover band is air. */
const MAX_BAR_PX = 24

/** A clean axis maximum and its tick step, never finer than one square. */
function niceScale(max: number): { top: number; step: number } {
  const rough = Math.max(max, 1) / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude)
  return { top: Math.max(step, Math.ceil(max / step) * step), step }
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** Line through the non-null points, broken wherever a value is null. */
function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function squaresWord(n: number): string {
  return n === 1 ? 'square' : 'squares'
}

/**
 * Which point a chart's readout describes. Tap or hover picks one; the default — and where a mouse
 * leaving puts it back — is the latest, so the readout above a chart always says something useful.
 * A touch tap stays put after the finger lifts, since there is no hover on a phone to come back to:
 * a readout that only lives while the pointer is down would be the hover-dependent affordance the
 * app avoids.
 */
function usePicked(count: number, fallback: number) {
  const [picked, setPicked] = useState<number | null>(null)
  const index = picked !== null && picked < count ? picked : fallback
  const pick = (left: number, band: number) => (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const i = Math.floor((event.clientX - box.left - left) / band)
    setPicked(Math.max(0, Math.min(count - 1, i)))
  }
  const release = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse') setPicked(null)
  }
  return { index, active: picked !== null && picked < count, pick, release }
}

/** Gridlines and y-axis labels at each tick step. Hairline and recessive: the data is the loud part. */
function YGrid({ top, step, y, width }: { top: number; step: number; y: (v: number) => number; width: number }) {
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  return (
    <g>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={PAD.left - 4} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-muted)">
            {fmt(v)}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * One chart over a run of days or weeks: optional columns, an optional line on top, an optional area
 * wash under the line. One y-axis — the line is always in the same unit as the columns (squares), so
 * there is never a second scale to reconcile.
 *
 * Only some x positions are `labelCandidates` (Mondays on a daily chart, so labels mark week starts);
 * of those, as many are labelled as fit, counted back from the latest so today's end is always named.
 */
function TimeChart({
  width,
  count,
  bars,
  partialLast,
  line,
  lineColor = 'var(--color-ink)',
  area,
  labelCandidates,
  xLabel,
  readout,
  ariaLabel,
}: {
  width: number
  count: number
  bars?: number[]
  /** Draw the last column faded: a day or week still being added to. */
  partialLast?: boolean
  line?: (number | null)[]
  lineColor?: string
  area?: boolean
  labelCandidates: (i: number) => boolean
  xLabel: (i: number) => string
  readout: (i: number) => ReactNode
  ariaLabel: string
}) {
  const plotW = width - PAD.left - PAD.right
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom
  const band = plotW / count
  const max = Math.max(0, ...(bars ?? []), ...(line ?? []).map((v) => v ?? 0))
  const { top, step } = niceScale(max)
  const x = (i: number) => PAD.left + band * (i + 0.5)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  // A 2px surface gap between touching columns; on a dense daily chart, where a column is only a few
  // pixels wide, the gap shrinks to 1px so the columns don't disappear into it.
  const barW = Math.min(MAX_BAR_PX, Math.max(1, band - (band >= 6 ? 2 : 1)))
  const { index, active, pick, release } = usePicked(count, count - 1)

  const candidates = Array.from({ length: count }, (_, i) => i).filter(labelCandidates)
  const every = Math.max(1, Math.ceil((candidates.length * X_LABEL_PX) / plotW))
  const labelled = candidates.filter((_, k) => (candidates.length - 1 - k) % every === 0)

  return (
    <div>
      <p className="min-h-4 text-xs text-muted">{readout(index)}</p>
      <svg
        width={width}
        height={CHART_HEIGHT}
        className="mt-1 block touch-pan-y select-none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={pick(PAD.left, band)}
        onPointerDown={pick(PAD.left, band)}
        onPointerLeave={release}
      >
        <YGrid top={top} step={step} y={y} width={width} />
        {active ? (
          <line x1={x(index)} x2={x(index)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-muted)" strokeWidth={1} />
        ) : null}
        {bars?.map((v, i) => (
          <path
            key={i}
            d={columnPath(x(i) - barW / 2, y(v), barW, y(0) - y(v))}
            fill="var(--color-accent)"
            opacity={(partialLast && i === count - 1 ? 0.4 : 1) * (active && i !== index ? 0.6 : 1)}
          />
        ))}
        {area && line ? (
          <path
            d={`${linePath(line, x, y)}L${x(count - 1)},${y(0)}L${x(0)},${y(0)}Z`}
            fill={lineColor}
            opacity={0.1}
          />
        ) : null}
        {line ? (
          <path d={linePath(line, x, y)} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {line && line[index] !== null && line[index] !== undefined && (active || area) ? (
          <circle cx={x(index)} cy={y(line[index]!)} r={4} fill={lineColor} stroke="var(--color-card)" strokeWidth={2} />
        ) : null}
        {labelled.map((i) => (
          <text
            key={i}
            x={Math.min(Math.max(x(i), PAD.left + 14), width - PAD.right - 14)}
            y={CHART_HEIGHT - 4}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-muted)"
          >
            {xLabel(i)}
          </text>
        ))}
      </svg>
    </div>
  )
}

/**
 * Average squares on each weekday as columns, with this week's and last week's actual counts as short
 * horizontal marks across them — "is this a normal Tuesday" at a glance. Marks rather than two more
 * columns per day: three columns side by side in a seventh of a phone screen are too thin to compare,
 * while a mark sitting above or below its column's top reads as "more" or "less" instantly.
 */
function WeekdayChart({ width, data, todayIndex }: { width: number; data: SquaresOverTime['weekdays']; todayIndex: number }) {
  const plotW = width - PAD.left - PAD.right
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom
  const band = plotW / 7
  const max = Math.max(0, ...data.flatMap((d) => [d.average, d.thisWeek ?? 0, d.lastWeek ?? 0]))
  const { top, step } = niceScale(max)
  const x = (i: number) => PAD.left + band * (i + 0.5)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const barW = Math.min(MAX_BAR_PX, band - 2)
  const markW = barW + 8
  const { index, active, pick, release } = usePicked(7, todayIndex)
  const picked = data[index]

  return (
    <div>
      <p className="min-h-4 text-xs text-muted">
        <span className="font-medium text-ink">{WEEKDAYS[index]}</span> · {fmt(picked.average)} on average · this week{' '}
        {picked.thisWeek === null ? 'not yet' : `${picked.thisWeek}${index === todayIndex ? ' so far' : ''}`} · last week{' '}
        {picked.lastWeek ?? '—'}
      </p>
      <svg
        width={width}
        height={CHART_HEIGHT}
        className="mt-1 block touch-pan-y select-none"
        role="img"
        aria-label={`Average squares per weekday: ${data.map((d, i) => `${WEEKDAYS[i]} ${fmt(d.average)}`).join(', ')}`}
        onPointerMove={pick(PAD.left, band)}
        onPointerDown={pick(PAD.left, band)}
        onPointerLeave={release}
      >
        <YGrid top={top} step={step} y={y} width={width} />
        {data.map((d, i) => (
          <g key={i} opacity={active && i !== index ? 0.6 : 1}>
            <path d={columnPath(x(i) - barW / 2, y(d.average), barW, y(0) - y(d.average))} fill="var(--color-accent)" opacity={0.45} />
            {d.lastWeek !== null ? (
              <line x1={x(i) - markW / 2} x2={x(i) + markW / 2} y1={y(d.lastWeek)} y2={y(d.lastWeek)} stroke="var(--color-ink)" strokeWidth={2} strokeLinecap="round" />
            ) : null}
            {/* This week drawn last, so it stays visible where it equals last week. */}
            {d.thisWeek !== null ? (
              <line x1={x(i) - markW / 2} x2={x(i) + markW / 2} y1={y(d.thisWeek)} y2={y(d.thisWeek)} stroke="var(--color-chart-1)" strokeWidth={2} strokeLinecap="round" />
            ) : null}
            <text x={x(i)} y={CHART_HEIGHT - 4} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontWeight={i === todayIndex ? 600 : undefined}>
              {WEEKDAYS[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/** Legend keys mirror the mark: a filled block for columns, a short stroke for a line or a mark. */
function Legend({ items }: { items: { label: string; kind: 'bar' | 'line'; color: string; opacity?: number }[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.kind === 'bar' ? (
            <span className="size-2.5 rounded-sm" style={{ background: item.color, opacity: item.opacity }} aria-hidden />
          ) : (
            <span className="h-0.5 w-3 rounded-full" style={{ background: item.color }} aria-hidden />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/**
 * Finished squares over time. Collapsed, one chart: squares per week (Monday to Sunday) with a
 * moving average, the trend a glance is for. Expanded adds the views that answer narrower questions —
 * which weekdays the crocheting happens on, the day-by-day record, and the running total.
 *
 * Every chart is hand-drawn SVG rather than a charting library: four simple charts don't justify a
 * runtime dependency, and the app takes no third-party scripts (CLAUDE.md, invariant 6).
 */
export function OverTimeCard({
  data,
  collapsed,
  onToggle,
}: {
  data: SquaresOverTime | null
  collapsed: boolean
  onToggle: () => void
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>()
  const width = measured || NARROWEST_CHART_PX

  return (
    <Card className="p-3">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={onToggle}>
        <span>
          <span className="block font-medium">Over time</span>
          <span className="mt-0.5 block text-xs text-muted">Finished squares (done or blocked), by date. Weeks run Monday to Sunday.</span>
        </span>
        <span className="tap-target shrink-0 text-xs text-accent">{collapsed ? 'Show all' : 'Collapse'}</span>
      </button>
      <div ref={ref} className="mt-2">
        {data === null ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <>
            <TimeChart
              width={width}
              count={data.weeks.length}
              bars={data.weeks.map((w) => w.count)}
              partialLast
              line={data.weeks.map((w) => w.average)}
              labelCandidates={() => true}
              xLabel={(i) => dayLabel(data.weeks[i].start)}
              readout={(i) => {
                const w = data.weeks[i]
                return (
                  <>
                    <span className="font-medium text-ink">
                      {w.partial ? 'This week' : `Week of ${dayLabel(w.start)}`}
                    </span>{' '}
                    · {w.count} {squaresWord(w.count)}
                    {w.partial ? ' so far' : ` · ${WEEKLY_AVERAGE_WEEKS}-week average ${fmt(w.average ?? 0)}`}
                  </>
                )
              }}
              ariaLabel={`Squares per week: ${data.weeks.map((w) => `week of ${dayLabel(w.start)} ${w.count}`).join(', ')}`}
            />
            <Legend
              items={[
                { label: 'squares per week', kind: 'bar', color: 'var(--color-accent)' },
                { label: `${WEEKLY_AVERAGE_WEEKS}-week average`, kind: 'line', color: 'var(--color-ink)' },
              ]}
            />

            {collapsed ? null : (
              <>
                <Section
                  title="By weekday"
                  note="Average squares on each day of the week, over the days that have finished."
                >
                  <WeekdayChart width={width} data={data.weekdays} todayIndex={weekdayIndex(data.days[data.days.length - 1].day)} />
                  <Legend
                    items={[
                      { label: 'average', kind: 'bar', color: 'var(--color-accent)', opacity: 0.45 },
                      { label: 'this week', kind: 'line', color: 'var(--color-chart-1)' },
                      { label: 'last week', kind: 'line', color: 'var(--color-ink)' },
                    ]}
                  />
                </Section>

                <Section title="Per day">
                  <TimeChart
                    width={width}
                    count={data.days.length}
                    bars={data.days.map((d) => d.count)}
                    partialLast
                    line={data.days.map((d) => d.average)}
                    labelCandidates={(i) => weekdayIndex(data.days[i].day) === 0}
                    xLabel={(i) => dayLabel(data.days[i].day)}
                    readout={(i) => {
                      const d = data.days[i]
                      return (
                        <>
                          <span className="font-medium text-ink">
                            {d.partial ? 'Today' : `${WEEKDAYS[weekdayIndex(d.day)]} ${dayLabel(d.day)}`}
                          </span>{' '}
                          · {d.count} {squaresWord(d.count)}
                          {d.partial ? ' so far' : ` · ${DAILY_AVERAGE_DAYS}-day average ${fmt(d.average ?? 0)}`}
                        </>
                      )
                    }}
                    ariaLabel={`Squares per day over ${data.days.length} days`}
                  />
                  <Legend
                    items={[
                      { label: 'squares per day', kind: 'bar', color: 'var(--color-accent)' },
                      { label: `${DAILY_AVERAGE_DAYS}-day average`, kind: 'line', color: 'var(--color-ink)' },
                    ]}
                  />
                </Section>

                <Section title="Running total">
                  <TimeChart
                    width={width}
                    count={data.days.length}
                    line={data.days.map((d) => d.cumulative)}
                    lineColor="var(--color-accent)"
                    area
                    labelCandidates={(i) => weekdayIndex(data.days[i].day) === 0}
                    xLabel={(i) => dayLabel(data.days[i].day)}
                    readout={(i) => {
                      const d = data.days[i]
                      return (
                        <>
                          <span className="font-medium text-ink">{d.partial ? 'Today' : dayLabel(d.day)}</span> ·{' '}
                          {d.cumulative} {squaresWord(d.cumulative)} in all
                        </>
                      )
                    }}
                    ariaLabel={`Running total of finished squares, ${data.days[data.days.length - 1].cumulative} today`}
                  />
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

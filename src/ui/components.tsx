import type { ReactNode } from 'react'
import { navigate } from '../app/router'

export function Link({
  to,
  className = '',
  children,
}: {
  to: string
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        // Let modifier-clicks open a new tab the way any other link would.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 disabled:opacity-40',
  secondary: 'bg-card text-ink border border-line hover:border-accent disabled:opacity-40',
  ghost: 'text-muted hover:text-ink disabled:opacity-40',
  danger: 'bg-card text-red-600 border border-red-300 hover:bg-red-50 disabled:opacity-40',
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-line bg-card ${className}`}>{children}</div>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'success' | 'info'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-line/60 text-muted',
    accent: 'bg-accent-soft text-accent',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    danger: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
    success: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
    info: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300',
  }
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A `colorlist` cell (`#111;#222`) split into its valid hex colours, in order. */
function splitHexList(value?: string): string[] {
  return (value ?? '')
    .split(';')
    .map((h) => h.trim())
    .filter((h) => HEX_RE.test(h))
}

/**
 * A yarn colour chip. `hex` can hold more than one colour in a single cell — a variegated yarn's
 * colourway (see `colorlist`, ADR 0019) — in which case the chip splits into equal stripes, one per
 * colour, filling the whole circle. Every colour gets the same weight: a colourway has no "primary",
 * and at the 14px sizes used in chips a stripe stays readable where a dot inside a fill did not.
 * Falls back to a dashed outline when no colour is recorded.
 */
export function Swatch({
  hex,
  size = 20,
  title,
  className = '',
}: {
  hex?: string
  size?: number
  title?: string
  className?: string
}) {
  const colours = splitHexList(hex)
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`inline-flex shrink-0 overflow-hidden rounded-full border ${colours.length > 0 ? 'border-black/15' : 'border-dashed border-line'} ${className}`}
      style={{ width: size, height: size, background: stripeBackground(colours) }}
    />
  )
}

/** An equal-width horizontal-stripe `background` for a list of hex colours (solid fill if just one). */
function stripeBackground(colours: string[]): string {
  if (colours.length === 0) return 'transparent'
  if (colours.length === 1) return colours[0]
  const step = 100 / colours.length
  return `linear-gradient(90deg, ${colours
    .map((hex, i) => `${hex} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
    .join(', ')})`
}

/**
 * One pie sector as a `clip-path` polygon: the centre, then an arc from `startTurn` to `endTurn`
 * (fractions of a full turn, clockwise from twelve o'clock). The radius deliberately overshoots the
 * box, so the only edges that land inside it are the two straight radii — the curved edge is cut by
 * the parent's `rounded-full`, which keeps it exactly circular however coarsely we step the arc.
 * A sector clips its own `background`, which is what lets a wedge hold linear stripes; a
 * `conic-gradient` can only put more wedges inside a wedge.
 */
function sectorClipPath(startTurn: number, endTurn: number): string {
  const radius = 80
  const steps = Math.max(2, Math.ceil((endTurn - startTurn) * 8))
  const points = ['50% 50%']
  for (let i = 0; i <= steps; i += 1) {
    const turn = startTurn + ((endTurn - startTurn) * i) / steps
    const angle = turn * 2 * Math.PI
    const x = 50 + radius * Math.sin(angle)
    const y = 50 - radius * Math.cos(angle)
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`)
  }
  return `polygon(${points.join(', ')})`
}

/**
 * A square's colour at a glance: the outer square shows the main yarn's colours as side-by-side
 * stripes, and a smaller circle inside gives each extra yarn its own pie wedge (`extra_yarns`' order is
 * meaningful, see `RefListInput`) — one wedge per yarn, in the order they were selected, matching the
 * pie-chart glyph this replaced (see ADR 0019, colour-imbalance stats work). A yarn's own `hex` can
 * itself be a `colorlist` (a variegated colourway); every colour in it gets its own stripe, so a
 * colourway reads the same way wherever it is drawn — across the outer square for the main yarn, and
 * clipped to that yarn's wedge of the inner circle for an extra one, never as wedges inside a wedge.
 * A single colour collapses to a solid fill, the trivial one-stripe case.
 */
export function ColourGlyph({
  mainHex,
  extraHexes = [],
  size = 32,
  title,
  className = '',
}: {
  mainHex?: string
  extraHexes?: (string | undefined)[]
  size?: number
  title?: string
  className?: string
}) {
  const mainColours = splitHexList(mainHex)
  const extraGroups = extraHexes.map((h) => splitHexList(h)).filter((g) => g.length > 0)
  const innerSize = Math.round(size * 0.52)

  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border ${
        mainColours.length > 0 ? 'border-black/15' : 'border-dashed border-line'
      } ${className}`}
      style={{ width: size, height: size, background: stripeBackground(mainColours) }}
    >
      {extraGroups.length > 0 ? (
        <span
          className="relative overflow-hidden rounded-full border border-black/20 shadow-sm"
          style={{ width: innerSize, height: innerSize }}
        >
          {extraGroups.map((colours, i) => (
            <span
              key={i}
              className="absolute inset-0"
              style={{
                background: stripeBackground(colours),
                // A lone extra yarn owns the whole circle, so it needs no clip at all.
                clipPath:
                  extraGroups.length > 1
                    ? sectorClipPath(i / extraGroups.length, (i + 1) / extraGroups.length)
                    : undefined,
              }}
            />
          ))}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Rows of badges docked to the right of a list row, as a plain flex sibling rather than a CSS float —
 * a float lets sibling text reflow into the narrow column beside it, which is what wrapping long
 * titles/subtitles around the badges instead of truncating them used to look like. `rows` is one
 * entry per visual row, outermost first; falsy badges and empty rows are dropped, so a caller can pass
 * conditional badges without pre-filtering. `shrink-0` keeps the stack its natural width when the text
 * beside it is truncating; the parent row's `items-center` is what actually centres it vertically.
 */
export function BadgeStack({
  rows,
  className = '',
}: {
  rows: (ReactNode | null | false | undefined)[][]
  className?: string
}) {
  const cleaned = rows
    .map((row) => row.filter((badge) => badge !== null && badge !== false && badge !== undefined))
    .filter((row) => row.length > 0)
  if (cleaned.length === 0) return null
  return (
    <div className={`flex shrink-0 flex-col items-end gap-1 ${className}`}>
      {cleaned.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center justify-end gap-1.5">
          {row}
        </div>
      ))}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-1.5">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-muted">
      <span
        className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
        aria-hidden
      />
      {label}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="mx-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
      {children}
    </div>
  )
}

export function FieldShell({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string
  help?: string
  error?: string | null
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="px-4 py-2.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-muted">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : help ? (
        <p className="mt-1 text-xs text-muted">{help}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'tap-target w-full rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-accent'

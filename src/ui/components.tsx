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
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
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
 * colourway (see `colorlist`, ADR 0019) — in which case the first fills the swatch and the rest show
 * as small dots inside it, capped at 4 so they stay legible even at the 14px swatches used in chips.
 * Falls back to a dashed outline when no colour is recorded.
 */
export function Swatch({ hex, size = 20, title }: { hex?: string; size?: number; title?: string }) {
  const [primary, ...extra] = splitHexList(hex)
  const dots = extra.slice(0, 4)
  const dotSize = Math.max(3, Math.round(size * 0.22))
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border ${primary ? 'border-black/15' : 'border-dashed border-line'}`}
      style={{ width: size, height: size, background: primary ?? 'transparent' }}
    >
      {dots.length > 0 ? (
        <span className="flex flex-wrap items-center justify-center gap-[1px]" style={{ width: size * 0.7 }}>
          {dots.map((h, i) => (
            <span
              key={i}
              className="rounded-full border border-black/25"
              style={{ width: dotSize, height: dotSize, background: h }}
            />
          ))}
        </span>
      ) : null}
    </span>
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
 * A `conic-gradient` background giving each group of colours its own equal pie wedge, and — when a
 * group holds more than one colour (a variegated yarn's `colorlist`) — subdividing that wedge into
 * further equal radial slices, one per colour, so a multi-colour yarn reads as stripes confined to its
 * own wedge rather than spilling into a neighbouring yarn's slice.
 */
function wedgeBackground(groups: string[][]): string {
  if (groups.length === 0) return 'transparent'
  if (groups.length === 1 && groups[0].length === 1) return groups[0][0]
  const wedgeStep = 100 / groups.length
  const stops: string[] = []
  groups.forEach((colours, i) => {
    const wedgeStart = i * wedgeStep
    const subStep = wedgeStep / colours.length
    colours.forEach((hex, j) => {
      const start = wedgeStart + j * subStep
      const end = wedgeStart + (j + 1) * subStep
      stops.push(`${hex} ${start.toFixed(2)}% ${end.toFixed(2)}%`)
    })
  })
  return `conic-gradient(${stops.join(', ')})`
}

/**
 * A square's colour at a glance: the outer square shows the main yarn's colours as side-by-side
 * stripes, and a smaller circle inside gives each extra yarn its own pie wedge (`extra_yarns`' order is
 * meaningful, see `RefListInput`) — one wedge per yarn, in the order they were selected, matching the
 * pie-chart glyph this replaced (see ADR 0019, colour-imbalance stats work). A yarn's own `hex` can
 * itself be a `colorlist` (a variegated colourway); every colour in it gets its own stripe — a radial
 * one inside that yarn's wedge, a linear one across the outer square for the main yarn — rather than
 * only the primary, unlike `Swatch`'s dots. A single colour collapses to a solid fill, the trivial
 * one-stripe case.
 */
export function ColourGlyph({
  mainHex,
  extraHexes = [],
  size = 32,
  title,
}: {
  mainHex?: string
  extraHexes?: (string | undefined)[]
  size?: number
  title?: string
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
      }`}
      style={{ width: size, height: size, background: stripeBackground(mainColours) }}
    >
      {extraGroups.length > 0 ? (
        <span
          className="rounded-full border border-black/20 shadow-sm"
          style={{ width: innerSize, height: innerSize, background: wedgeBackground(extraGroups) }}
        />
      ) : null}
    </span>
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
    <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
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
    <div className="px-4 py-3">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-muted">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
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

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

/** A yarn colour chip. Falls back to a dashed outline when no hex is recorded. */
export function Swatch({ hex, size = 20, title }: { hex?: string; size?: number; title?: string }) {
  const valid = hex && HEX_RE.test(hex)
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`inline-block shrink-0 rounded-full border ${valid ? 'border-black/15' : 'border-dashed border-line'}`}
      style={{ width: size, height: size, background: valid ? hex : 'transparent' }}
    />
  )
}

/**
 * A square's colour at a glance: main colour fills the outer square, extra colours share a smaller
 * circle inside it — one wedge per extra colour, like a pie chart, in the order they were selected
 * (`extra_yarns`' order is meaningful, see `RefListInput`). A single extra colour is just a solid
 * inner circle, the trivial one-wedge case.
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
  const validMain = mainHex && HEX_RE.test(mainHex)
  const extras = extraHexes.filter((h): h is string => !!h && HEX_RE.test(h))
  const innerSize = Math.round(size * 0.52)

  let innerBackground = 'transparent'
  if (extras.length === 1) {
    innerBackground = extras[0]
  } else if (extras.length > 1) {
    const step = 100 / extras.length
    innerBackground = `conic-gradient(${extras
      .map((hex, i) => `${hex} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
      .join(', ')})`
  }

  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-md border ${
        validMain ? 'border-black/15' : 'border-dashed border-line'
      }`}
      style={{ width: size, height: size, background: validMain ? mainHex : 'transparent' }}
    >
      {extras.length > 0 ? (
        <span
          className="rounded-full border border-black/20 shadow-sm"
          style={{ width: innerSize, height: innerSize, background: innerBackground }}
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

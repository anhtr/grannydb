/**
 * What colour a square's status is — in both places one is drawn.
 *
 * A status has had a colour since long before it had a chart: the badge on a Squares row. So the
 * Progress screen's status bar takes that colour rather than inventing a second scale, and this module
 * is the one place the mapping lives, keyed by the status value itself. A badge and a bar segment for
 * the same status can then only ever agree.
 *
 * The two differ in *weight*, not in hue: a badge is a pale tint with dark text (right for a chip,
 * far too light for a mark), while a chart mark is the solid fill of the same family — see
 * `--color-status-*` in `styles.css`, which also records why "in progress" shifts from the badge's
 * amber to a yellow once it has to sit next to "planned" in one bar.
 *
 * A status the schema no longer lists falls through to a neutral badge and a muted segment, rather
 * than to some other status's colour.
 */
import type { BadgeTone } from './components'

const STATUS_TONES: Record<string, BadgeTone> = {
  planned: 'danger',
  'in progress': 'warn',
  done: 'success',
  blocked: 'info',
}

const STATUS_MARKS: Record<string, string> = {
  planned: 'var(--color-status-planned)',
  'in progress': 'var(--color-status-progress)',
  done: 'var(--color-status-done)',
  blocked: 'var(--color-status-blocked)',
}

/** The badge tone for a status — what a Squares row wears. */
export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral'
}

/** The solid fill for a status — what a chart mark wears. */
export function statusMark(status: string): string {
  return STATUS_MARKS[status] ?? 'var(--color-muted)'
}

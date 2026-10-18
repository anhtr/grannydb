import type { Issue } from '../schema'

/**
 * `project.json` — facts about the project as a whole rather than about any one row: when it
 * started and how many squares it is aiming at. Data, not a device preference, so every device
 * agrees on them and changing one is a synced, reviewable commit like any other edit.
 *
 * Kept as the raw parsed object rather than a typed record so that a key added by hand survives a
 * write from the app — the JSON counterpart of the CSV writer preserving unknown columns.
 */
export type ProjectDoc = Record<string, unknown>

/** A value a queued project edit can carry. `null` removes the key. */
export type ProjectValue = string | number | null

/** The keys the app reads, resolved to usable values. Anything missing or malformed reads as unset. */
export interface ProjectInfo {
  /** `YYYY-MM-DD`, or empty if unset. */
  startDate: string
  /** Target number of squares, or 0 for no target. */
  targetSquares: number
}

export const PROJECT_KEYS = { startDate: 'start_date', targetSquares: 'target_squares' } as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Lives beside `schema/` in the data directory, so pointing Settings at another data dir moves it too. */
export function projectPath(dataDir: string): string {
  return `${dataDir}/project.json`
}

export function parseProject(text: string): ProjectDoc {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('project.json must be a JSON object.')
  }
  return parsed as ProjectDoc
}

/** Two-space indented with a trailing newline, so an app write and a hand edit diff the same way. */
export function serializeProject(doc: ProjectDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export function projectInfo(doc: ProjectDoc): ProjectInfo {
  const start = doc[PROJECT_KEYS.startDate]
  const target = doc[PROJECT_KEYS.targetSquares]
  return {
    startDate: typeof start === 'string' && DATE_RE.test(start) ? start : '',
    targetSquares: typeof target === 'number' && Number.isInteger(target) && target > 0 ? target : 0,
  }
}

/** The same data-contract check the CSVs get, so a hand edit that breaks a value fails the build. */
export function validateProject(doc: ProjectDoc): Issue[] {
  const issues: Issue[] = []
  const at = (field: string, message: string) => issues.push({ table: 'project', rowId: '', field, message })
  const start = doc[PROJECT_KEYS.startDate]
  if (start !== undefined && start !== '' && !(typeof start === 'string' && DATE_RE.test(start))) {
    at(PROJECT_KEYS.startDate, `expected a YYYY-MM-DD date, got ${JSON.stringify(start)}`)
  }
  const target = doc[PROJECT_KEYS.targetSquares]
  if (target !== undefined && !(typeof target === 'number' && Number.isInteger(target) && target >= 0)) {
    at(PROJECT_KEYS.targetSquares, `expected a whole number, got ${JSON.stringify(target)}`)
  }
  return issues
}

/** Set (or, for `null`, remove) the given keys, leaving every other key where it was. */
export function applyProjectValues(doc: ProjectDoc, values: Readonly<Record<string, ProjectValue>>): ProjectDoc {
  const next: ProjectDoc = { ...doc }
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

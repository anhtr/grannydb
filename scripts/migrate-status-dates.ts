/**
 * One-off migration: replace the squares table's single `date` column with a date per status
 * (`planned_date`, `started_date`, `done_date`, `blocked_date`), recovering the missing dates from git
 * history. See ADR 0031.
 *
 *   npx tsx scripts/migrate-status-dates.ts           # dry run: print what each square would get
 *   npx tsx scripts/migrate-status-dates.ts --write   # rewrite data/squares.csv
 *
 * It replays every committed version of `data/squares.csv`, oldest first, and follows each square:
 *
 * - **Added as blocked:** its date is both its done and its blocked date.
 * - **Added with any other status:** its date is that status's date.
 * - **Status changed, date unchanged:** the new status is dated by the commit, as a calendar day in
 *   the project's time zone. A commit is when the change *synced*, which for this history was within
 *   hours of making it.
 * - **Status changed and date changed in the same commit:** the edited date belongs to the new status,
 *   and the old date stays with the old one — whoever changed both was dating the new status.
 * - **Date changed, status unchanged:** a correction, applied to whichever status the `date` column
 *   was recording at that point.
 *
 * Kept in the repo after it has run, as the record of where the backfilled dates came from.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../src/core/csv/parse'
import { serializeCsv } from '../src/core/csv/serialize'
import type { CsvRow } from '../src/core/csv/types'
import { today } from '../src/core/date'
import { parseProject, projectInfo } from '../src/core/project'
import { parseBool } from '../src/core/schema/validate'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'data/squares.csv'
const ORDER = ['planned', 'in progress', 'done', 'blocked']
const COLUMN: Record<string, string> = {
  planned: 'planned_date',
  'in progress': 'started_date',
  done: 'done_date',
  blocked: 'blocked_date',
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1 << 26 }).toString()

const projectFile = join(repoRoot, 'data/project.json')
const timeZone = existsSync(projectFile) ? projectInfo(parseProject(readFileSync(projectFile, 'utf8'))).timeZone : ''

interface Track {
  status: string
  date: string
  dates: Record<string, string>
  /** Which statuses the `date` column is currently recording — both done and blocked for a square
   * added as blocked, until its status next changes. */
  owners: string[]
  log: string[]
}

/** The very first version kept "blocked" as a separate yes/no column rather than a status. */
function statusOf(row: CsvRow): string {
  return row.blocked !== undefined && parseBool(row.blocked) ? 'blocked' : (row.status ?? '')
}

const commits = git('log', '--reverse', '--format=%h %aI', '--', FILE).trim().split('\n')
const tracks = new Map<string, Track>()

for (const line of commits) {
  const [sha, at] = line.split(' ')
  const day = today(timeZone, new Date(at))
  const rows = parseCsv(git('show', `${sha}:${FILE}`)).rows
  const present = new Set<string>()
  for (const row of rows) {
    const id = row.id ?? ''
    present.add(id)
    const status = statusOf(row)
    const date = row.date ?? ''
    const t = tracks.get(id)
    if (!t) {
      const owners = status === 'blocked' ? ['done', 'blocked'] : status ? [status] : []
      const dates: Record<string, string> = {}
      for (const s of owners) dates[s] = date
      tracks.set(id, { status, date, dates, owners, log: [`${sha} added ${status || '(no status)'} ${date}`] })
      continue
    }
    if (status !== t.status) {
      const dated = date !== t.date ? date : day
      // A status moved backwards no longer has the later statuses' dates.
      for (const s of ORDER.slice(ORDER.indexOf(status) + 1)) delete t.dates[s]
      t.dates[status] = dated
      if (status === 'blocked' && !t.dates.done) t.dates.done = dated
      if (date !== t.date) t.owners = [status]
      t.log.push(`${sha} ${t.status} → ${status}, ${status} dated ${dated}${date !== t.date ? ' (date edited with it)' : ' (commit day)'}`)
    } else if (date !== t.date) {
      for (const s of t.owners) t.dates[s] = date
      t.log.push(`${sha} date ${t.date} → ${date}, for ${t.owners.join(' and ')}`)
    }
    t.status = status
    t.date = date
  }
  // A square removed and later re-added under the same id starts its history again.
  for (const id of [...tracks.keys()]) if (!present.has(id)) tracks.delete(id)
}

try {
  git('diff', '--quiet', 'HEAD', '--', FILE)
} catch {
  throw new Error(`${FILE} has uncommitted changes; commit or discard them so history and file agree.`)
}
const table = parseCsv(readFileSync(join(repoRoot, FILE), 'utf8'))
if (!table.columns.includes('date')) throw new Error(`${FILE} has no "date" column — already migrated?`)

const switched: string[] = []
for (const row of table.rows) {
  const t = tracks.get(row.id ?? '')
  if (!t) throw new Error(`${row.id} is in ${FILE} but not in its committed history`)
  for (const [status, column] of Object.entries(COLUMN)) row[column] = t.dates[status] ?? ''
  delete row.date
  if (t.log.length > 1) switched.push(`${row.id}: ${ORDER.filter((s) => t.dates[s]).map((s) => `${s} ${t.dates[s]}`).join(', ')}\n    ${t.log.join('\n    ')}`)
}
// Straight after `status`, the order the schema lists them in, so the CSV reads in the form's order.
table.columns.splice(table.columns.indexOf('date'), 1)
table.columns.splice(table.columns.indexOf('status') + 1, 0, ...Object.values(COLUMN))

console.log(`time zone: ${timeZone || '(device)'}; ${table.rows.length} squares, ${switched.length} with later changes:\n`)
console.log(switched.join('\n'))
if (process.argv.includes('--write')) {
  writeFileSync(join(repoRoot, FILE), serializeCsv(table))
  console.log(`\nwrote ${FILE}`)
} else {
  console.log('\ndry run — pass --write to rewrite the file')
}

import type { CsvRow } from '../../core/csv'
import { effectiveGoal } from '../../core/prefs'
import { splitList, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useAppState, useLookup, useTable, useTableSchema } from '../../app/hooks'
import { Badge, Card, ColourGlyph } from '../../ui/components'
import { RecordList } from '../../ui/RecordList'

const statusTone: Record<string, 'neutral' | 'accent' | 'warn' | 'danger' | 'success' | 'info'> = {
  planned: 'danger',
  'in progress': 'warn',
  done: 'success',
  blocked: 'info',
}

/** Progress toward the blanket, shown above the list because it is the reason for the app. */
function ProgressHeader({ schema }: { schema: TableSchema }) {
  const table = useTable('squares')
  const prefs = useAppState().prefs
  const goal = effectiveGoal(schema, prefs)
  if (!table || goal === 0) return null

  // `blocked` is the stage after `done`, so a blocked square still counts toward the goal.
  const done = table.rows.filter((r) => r.status === 'done' || r.status === 'blocked').length
  const percent = Math.min(100, Math.round((done / goal) * 100))

  return (
    <Card className="mx-4 mt-2 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">Squares finished</p>
        <p className="text-sm font-medium">
          {done} <span className="text-muted">/ {goal}</span>
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={goal}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </Card>
  )
}

function SquareRow({ row }: { row: CsvRow }) {
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const designs = useLookup('designs')

  const yarnTitle = (id: string) => {
    const yarn = yarns.get(id)
    return yarn && yarnSchema ? titleFor(yarnSchema, yarn) : undefined
  }

  const mainYarn = yarns.get(row.main_yarn ?? '')
  const extras = splitList(row.extra_yarns ?? '')
  const design = designs.get(row.design_id ?? '')
  const status = row.status ?? ''

  const glyphTitle = [yarnTitle(row.main_yarn ?? ''), ...extras.map(yarnTitle)]
    .filter((t): t is string => !!t)
    .join(' + ')

  return (
    <div className="flex items-center gap-3">
      <ColourGlyph
        mainHex={mainYarn?.hex}
        extraHexes={extras.map((id) => yarns.get(id)?.hex)}
        size={32}
        title={glyphTitle || undefined}
      />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          <span className="font-mono text-sm">{row.id}</span>
        </p>
        <p className="truncate text-sm text-muted">
          {design?.name ?? '(no design)'}
          {row.date ? ` · ${row.date}` : ''}
        </p>
      </div>

      {status ? <Badge tone={statusTone[status] ?? 'neutral'}>{status}</Badge> : null}
    </div>
  )
}

export function SquaresPage() {
  const schema = useTableSchema('squares')
  return (
    <RecordList
      table="squares"
      header={schema ? <ProgressHeader schema={schema} /> : null}
      renderRow={(row) => <SquareRow row={row} />}
    />
  )
}

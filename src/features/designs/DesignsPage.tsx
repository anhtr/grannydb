import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { designSquareCounts, fieldByKey, refDisplayLabel, titleFor } from '../../core/schema'
import type { ResolveRef, TableSchema } from '../../core/schema'
import { useResolveRef, useTable } from '../../app/hooks'
import { Badge } from '../../ui/components'
import type { ComputedSortOption } from '../../ui/RecordList'
import { RecordList } from '../../ui/RecordList'

function DesignRow({
  row,
  schema,
  count,
  resolve,
}: {
  row: CsvRow
  schema: TableSchema
  count: number
  resolve: ResolveRef
}) {
  const title = titleFor(schema, row) || '(untitled)'
  const subtitleField = schema.subtitleField ? fieldByKey(schema, schema.subtitleField) : undefined
  const subtitle = subtitleField ? refDisplayLabel(subtitleField, row[subtitleField.key] ?? '', resolve) : ''

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge tone={count === 0 ? 'neutral' : 'accent'}>
          {count} square{count === 1 ? '' : 's'}
        </Badge>
        <span className="font-mono text-xs text-muted">{row[schema.idField]}</span>
      </div>
    </div>
  )
}

export function DesignsPage() {
  const squares = useTable('squares')
  const resolve = useResolveRef()

  const counts = useMemo(() => (squares ? designSquareCounts(squares) : new Map<string, number>()), [squares])

  const extraSortOptions = useMemo<ComputedSortOption[]>(
    () => [{ key: 'square_count', label: 'Squares', value: (row) => counts.get(row.id) ?? 0 }],
    [counts],
  )

  return (
    <RecordList
      table="designs"
      renderRow={(row, schema) => (
        <DesignRow row={row} schema={schema} count={counts.get(row.id) ?? 0} resolve={resolve} />
      )}
      extraSortOptions={extraSortOptions}
    />
  )
}

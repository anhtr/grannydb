import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { designSquareCounts, fieldByKey, refDisplayLabel, titleFor } from '../../core/schema'
import type { ResolveRef, TableSchema } from '../../core/schema'
import { useResolveRef, useTable } from '../../app/hooks'
import { Badge, BadgeStack } from '../../ui/components'
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
  const construction = row.construction_type ?? ''

  return (
    <div className="overflow-hidden">
      <BadgeStack
        rows={[
          [
            <Badge key="count" tone={count === 0 ? 'neutral' : 'accent'}>
              {count} square{count === 1 ? '' : 's'}
            </Badge>,
            <span key="id" className="font-mono text-xs text-muted">
              {row[schema.idField]}
            </span>,
          ],
          [construction ? <Badge key="construction" tone="neutral">{construction}</Badge> : null],
        ]}
      />
      <div>
        <p className="font-medium">{title}</p>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
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

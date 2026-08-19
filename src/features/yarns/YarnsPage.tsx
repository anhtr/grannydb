import type { CsvRow } from '../../core/csv'
import { parseBool, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { Badge, Swatch } from '../../ui/components'
import { RecordList } from '../../ui/RecordList'

function YarnRow({ row, schema }: { row: CsvRow; schema: TableSchema }) {
  const title = titleFor(schema, row) || '(untitled)'
  const subtitle = row.product_line ?? ''
  const skeins = Math.max(0, Math.floor(Number(row.skeins) || 0))
  const partial = parseBool(row.partial_skein ?? '')

  return (
    <div className="flex items-center gap-3">
      <Swatch hex={row.hex} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-sm text-muted">
          {subtitle}
          {subtitle ? ' · ' : ''}
          {row.id}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge tone={skeins === 0 ? 'neutral' : 'accent'}>
          {skeins} skein{skeins === 1 ? '' : 's'}
        </Badge>
        {partial ? <Badge tone="warn">Partial</Badge> : null}
      </div>
    </div>
  )
}

export function YarnsPage() {
  return <RecordList table="yarns" renderRow={(row, schema) => <YarnRow row={row} schema={schema} />} />
}

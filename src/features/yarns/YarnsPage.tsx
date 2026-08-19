import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { isYarnActive, parseBool, titleFor, yarnUsageCounts } from '../../core/schema'
import type { YarnUsage } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useTable } from '../../app/hooks'
import { Badge, Swatch } from '../../ui/components'
import type { ComputedSortOption, FilterDescriptor } from '../../ui/RecordList'
import { RecordList } from '../../ui/RecordList'

function YarnRow({ row, schema, usage }: { row: CsvRow; schema: TableSchema; usage: YarnUsage | undefined }) {
  const title = titleFor(schema, row) || '(untitled)'
  const subtitle = row.product_line ?? ''
  const skeins = Math.max(0, Math.floor(Number(row.skeins) || 0))
  const partial = parseBool(row.partial_skein ?? '')
  const main = usage?.main ?? 0
  const extra = usage?.extra ?? 0

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
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Badge tone={skeins === 0 ? 'neutral' : 'accent'}>
          {skeins} skein{skeins === 1 ? '' : 's'}
        </Badge>
        {partial ? <Badge tone="warn">Partial</Badge> : null}
        {main > 0 ? <Badge tone="info">{main} main</Badge> : null}
        {extra > 0 ? <Badge tone="neutral">{extra} extra</Badge> : null}
      </div>
    </div>
  )
}

export function YarnsPage() {
  const squares = useTable('squares')

  const usageByYarn = useMemo(() => (squares ? yarnUsageCounts(squares) : new Map<string, YarnUsage>()), [squares])

  const extraSortOptions = useMemo<ComputedSortOption[]>(
    () => [
      { key: 'usage_main', label: 'Squares (main)', value: (row) => usageByYarn.get(row.id)?.main ?? 0 },
      { key: 'usage_extra', label: 'Squares (extra)', value: (row) => usageByYarn.get(row.id)?.extra ?? 0 },
    ],
    [usageByYarn],
  )

  const extraFilters = useMemo<FilterDescriptor[]>(
    () => [
      {
        key: 'active',
        label: 'Active',
        options: [
          { value: 'yes', label: 'Active' },
          { value: 'no', label: 'Inactive' },
        ],
        matches: (row, value) => {
          const active = isYarnActive(row, usageByYarn.get(row.id))
          return value === 'yes' ? active : !active
        },
      },
    ],
    [usageByYarn],
  )

  return (
    <RecordList
      table="yarns"
      renderRow={(row, schema) => <YarnRow row={row} schema={schema} usage={usageByYarn.get(row.id)} />}
      extraSortOptions={extraSortOptions}
      extraFilters={extraFilters}
    />
  )
}

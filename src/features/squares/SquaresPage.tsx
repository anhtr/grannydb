import type { CsvRow } from '../../core/csv'
import { effectiveValue, fieldByKey, splitList, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useLookup, useResolveRef, useTableSchema } from '../../app/hooks'
import { Badge, BadgeStack, ColourGlyph } from '../../ui/components'
import { RecordList } from '../../ui/RecordList'

const statusTone: Record<string, 'neutral' | 'accent' | 'warn' | 'danger' | 'success' | 'info'> = {
  planned: 'danger',
  'in progress': 'warn',
  done: 'success',
  blocked: 'info',
}

function SquareRow({ row, schema }: { row: CsvRow; schema: TableSchema }) {
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const designs = useLookup('designs')
  const resolve = useResolveRef()

  const yarnTitle = (id: string) => {
    const yarn = yarns.get(id)
    return yarn && yarnSchema ? titleFor(yarnSchema, yarn) : undefined
  }

  const mainYarn = yarns.get(row.main_yarn ?? '')
  const extras = splitList(row.extra_yarns ?? '')
  const design = designs.get(row.design_id ?? '')
  const status = row.status ?? ''
  const constructionField = fieldByKey(schema, 'construction_type')
  const construction = constructionField ? effectiveValue(schema, constructionField, row, resolve).value : ''

  const mainTitle = yarnTitle(row.main_yarn ?? '')
  const extraTitles = extras.map(yarnTitle).filter((t): t is string => !!t)
  // Main and extras in one breath, main first — same order the glyph draws them in.
  const colourNames = [mainTitle, ...extraTitles].filter((t): t is string => !!t).join('/')
  const glyphTitle = [mainTitle, ...extraTitles].filter((t): t is string => !!t).join(' + ')

  return (
    <div className="flex items-center gap-3">
      <ColourGlyph
        mainHex={mainYarn?.hex}
        mainPattern={mainYarn?.pattern}
        extraHexes={extras.map((id) => yarns.get(id)?.hex)}
        extraPatterns={extras.map((id) => yarns.get(id)?.pattern)}
        size={32}
        title={glyphTitle || undefined}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          <span className="font-mono text-sm">{row.id}</span>
          {colourNames ? (
            <>
              <span className="text-muted"> • </span>
              <span className="text-xs font-normal text-muted">{colourNames}</span>
            </>
          ) : null}
        </p>
        <p className="truncate text-sm text-muted">
          {design?.name ?? '(no design)'}
          {row.date ? ` · ${row.date}` : ''}
        </p>
      </div>
      <BadgeStack
        rows={[
          [
            status ? (
              <Badge key="status" tone={statusTone[status] ?? 'neutral'}>
                {status}
              </Badge>
            ) : null,
          ],
          [
            construction ? (
              <Badge key="construction" tone="neutral">
                {construction}
              </Badge>
            ) : null,
          ],
        ]}
      />
    </div>
  )
}

export function SquaresPage() {
  return <RecordList table="squares" renderRow={(row, schema) => <SquareRow row={row} schema={schema} />} />
}

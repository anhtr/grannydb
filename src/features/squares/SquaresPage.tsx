import { useMemo } from 'react'
import type { CsvRow } from '../../core/csv'
import { compareIds } from '../../core/csv'
import { effectiveValue, fieldByKey, splitList, squareYarnIds, statusDate, titleFor } from '../../core/schema'
import type { TableSchema } from '../../core/schema'
import { useLookup, useResolveRef, useTable, useTableSchema } from '../../app/hooks'
import { Badge, BadgeStack, ColourGlyph } from '../../ui/components'
import { RecordList } from '../../ui/RecordList'
import type { FilterDescriptor } from '../../ui/RecordList'
import { statusTone } from '../../ui/status'

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
          {/* The date it reached its current status — so a blocked square shows when it was blocked. */}
          {statusDate(schema, row) ? ` · ${statusDate(schema, row)}` : ''}
        </p>
      </div>
      <BadgeStack
        rows={[
          [
            status ? (
              <Badge key="status" tone={statusTone(status)}>
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
  const squares = useTable('squares')
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')

  // "Which squares have this colour in them at all?" spans two columns, `main_yarn` and
  // `extra_yarns`, so no single field's `"filter": true` can answer it. Passed in through the same
  // escape hatch the Yarns list uses for its cross-table counts (ADR 0022). The schema's own Main
  // colour filter stays, for when it matters which role the colour plays.
  const extraFilters = useMemo<FilterDescriptor[]>(() => {
    const used = new Set((squares?.rows ?? []).flatMap(squareYarnIds))
    const options = [...used]
      .map((id) => {
        const yarn = yarns.get(id)
        return { value: id, label: yarn && yarnSchema ? titleFor(yarnSchema, yarn) : id }
      })
      .sort((a, b) => compareIds(a.label, b.label))
    return [
      {
        key: 'any_yarn',
        label: 'Any colour (main or extra)',
        options,
        matches: (row, value) => squareYarnIds(row).includes(value),
      },
    ]
  }, [squares, yarns, yarnSchema])

  return (
    <RecordList
      table="squares"
      renderRow={(row, schema) => <SquareRow row={row} schema={schema} />}
      extraFilters={extraFilters}
    />
  )
}

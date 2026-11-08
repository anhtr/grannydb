import type { ReactNode } from 'react'
import { titleFor } from '../core/schema'
import type { ColourCombination } from '../core/schema'
import { useLookup, useTableSchema } from '../app/hooks'
import { Card, ColourGlyph, Link } from './components'

/**
 * A card of colour combinations — glyph, a line naming the colours, a square count, and a link to
 * each square — shared by the yarn and design detail views. What the line says differs by page (a
 * yarn names its partners; a design names every colour), so the caller supplies `describe`, and
 * `glyphExtras` says which extras to draw when the combination leaves one out. `squareGroups`, when
 * given, splits each combination's square links into labelled runs (the yarn view uses it for
 * construction type), in `order`; a square whose group is blank goes last, unlabelled.
 */
export function ColourCombinationCard({
  title,
  items,
  empty,
  describe,
  glyphExtras = (combo) => combo.extras,
  squareGroups,
}: {
  title: string
  items: ColourCombination[]
  empty: string
  describe: (combo: ColourCombination, name: (yarnId: string) => string) => ReactNode
  glyphExtras?: (combo: ColourCombination) => string[]
  squareGroups?: { of: (squareId: string) => string; order: string[] }
}) {
  const yarns = useLookup('yarns')
  const yarnSchema = useTableSchema('yarns')
  const name = (id: string) => {
    const yarn = yarns.get(id)
    return (yarn && yarnSchema ? titleFor(yarnSchema, yarn) : '') || id
  }

  return (
    <Card className="mx-4 p-3">
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((combo) => {
            const extras = glyphExtras(combo)
            const mainYarn = yarns.get(combo.main)
            return (
              <li key={`${combo.main}|${combo.extras.join(';')}`} className="flex items-start gap-3">
                <ColourGlyph
                  mainHex={mainYarn?.hex}
                  mainPattern={mainYarn?.pattern}
                  extraHexes={extras.map((id) => yarns.get(id)?.hex)}
                  extraPatterns={extras.map((id) => yarns.get(id)?.pattern)}
                  size={28}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1">{describe(combo, name)}</span>
                    <span className="tabular-nums text-muted">
                      {combo.squareIds.length} square{combo.squareIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {squareGroups ? (
                    groupSquares(combo.squareIds, squareGroups).map(([group, ids]) => (
                      <p key={group} className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                        {group ? <span className="text-muted">{group}</span> : null}
                        <SquareLinks ids={ids} />
                      </p>
                    ))
                  ) : (
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                      <SquareLinks ids={combo.squareIds} />
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function SquareLinks({ ids }: { ids: string[] }) {
  return ids.map((id) => (
    <Link key={id} to={`/squares/${id}`} className="font-mono text-accent hover:underline">
      {id}
    </Link>
  ))
}

/**
 * Square ids bucketed by group, in the given order. A group the order does not list (a hand-typed
 * value outside the schema's options) still shows, after the known ones, rather than its squares
 * vanishing from the card.
 */
export function groupSquares(ids: string[], { of, order }: { of: (id: string) => string; order: string[] }): [string, string[]][] {
  const buckets = new Map<string, string[]>()
  for (const id of ids) {
    const group = of(id)
    buckets.set(group, [...(buckets.get(group) ?? []), id])
  }
  const rank = (group: string) => (group === '' ? Infinity : order.includes(group) ? order.indexOf(group) : order.length)
  return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
}

import { useMemo } from 'react'
import { titleFor, yarnCombinations } from '../../core/schema'
import type { YarnCombination } from '../../core/schema'
import { useLookup, useTable, useTableSchema } from '../../app/hooks'
import { Card, ColourGlyph, Link } from '../../ui/components'

/**
 * The colour combinations a yarn has gone into, as main and as extra — mounted under the yarn's
 * detail view. Aggregated from `squares` at read time (`yarnCombinations`), so there is nothing to
 * keep in sync: change a square's colours and this follows.
 */
export function YarnCombinations({ yarnId }: { yarnId: string }) {
  const squares = useTable('squares')
  const combos = useMemo(() => (squares ? yarnCombinations(squares, yarnId) : null), [squares, yarnId])
  if (!combos) return null

  return (
    <>
      <CombinationCard
        title="Used as main"
        role="main"
        yarnId={yarnId}
        items={combos.asMain}
        empty="No square uses this as its main colour yet."
      />
      <CombinationCard
        title="Used as extra"
        role="extra"
        yarnId={yarnId}
        items={combos.asExtra}
        empty="No square uses this as an extra colour yet."
      />
    </>
  )
}

function CombinationCard({
  title,
  role,
  yarnId,
  items,
  empty,
}: {
  title: string
  role: 'main' | 'extra'
  yarnId: string
  items: YarnCombination[]
  empty: string
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
            // The glyph draws the whole square — this yarn included — in its real role, so an extra
            // row shows this yarn as a wedge; the text names only the partners, since this yarn is
            // what the page is about.
            const extras = role === 'main' ? combo.extras : [yarnId, ...combo.extras]
            const mainYarn = yarns.get(combo.main)
            const partners =
              role === 'main'
                ? combo.extras.length > 0
                  ? `with ${combo.extras.map(name).join(' + ')}`
                  : 'On its own'
                : `${combo.main ? `${name(combo.main)} main` : '(no main colour)'}${
                    combo.extras.length > 0 ? `, with ${combo.extras.map(name).join(' + ')}` : ''
                  }`
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
                    <span className="min-w-0 flex-1">{partners}</span>
                    <span className="tabular-nums text-muted">
                      {combo.squareIds.length} square{combo.squareIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                    {combo.squareIds.map((id) => (
                      <Link key={id} to={`/squares/${id}`} className="font-mono text-accent hover:underline">
                        {id}
                      </Link>
                    ))}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

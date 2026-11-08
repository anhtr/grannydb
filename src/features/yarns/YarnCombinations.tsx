import { useMemo } from 'react'
import { effectiveValue, fieldByKey, yarnCombinations } from '../../core/schema'
import { useResolveRef, useTable, useTableSchema } from '../../app/hooks'
import { ColourCombinationCard } from '../../ui/ColourCombinationCard'

/**
 * The colour combinations a yarn has gone into, as main and as extra — mounted under the yarn's
 * detail view. Aggregated from `squares` at read time (`yarnCombinations`), so there is nothing to
 * keep in sync: change a square's colours and this follows.
 */
export function YarnCombinations({ yarnId }: { yarnId: string }) {
  const squares = useTable('squares')
  const squareSchema = useTableSchema('squares')
  const resolve = useResolveRef()
  const combos = useMemo(() => (squares ? yarnCombinations(squares, yarnId) : null), [squares, yarnId])

  // Square links are split by construction type, since a colour's squares are meant to come out
  // balanced across solid and holey. Effective value, not the raw cell: a blank cell means "same as
  // the design" (ADR 0016), so reading the column alone would leave most squares unlabelled.
  const squareGroups = useMemo(() => {
    const field = squareSchema ? fieldByKey(squareSchema, 'construction_type') : undefined
    if (!squares || !squareSchema || !field) return undefined
    const byId = new Map(
      squares.rows.map((row) => [row.id ?? '', effectiveValue(squareSchema, field, row, resolve).value]),
    )
    return { of: (id: string) => byId.get(id) ?? '', order: field.options ?? [] }
  }, [squares, squareSchema, resolve])

  if (!combos) return null

  // Each glyph draws the whole square, this yarn included, in its real role, so an extra row shows
  // this yarn as a wedge. The text names only the partners, since this yarn is what the page is about.
  return (
    <>
      <ColourCombinationCard
        title="Used as main"
        items={combos.asMain}
        empty="No square uses this as its main colour yet."
        squareGroups={squareGroups}
        describe={(combo, name) =>
          combo.extras.length > 0 ? `with ${combo.extras.map(name).join(' + ')}` : 'On its own'
        }
      />
      <ColourCombinationCard
        title="Used as extra"
        items={combos.asExtra}
        empty="No square uses this as an extra colour yet."
        squareGroups={squareGroups}
        describe={(combo, name) =>
          `${combo.main ? `${name(combo.main)} main` : '(no main colour)'}${
            combo.extras.length > 0 ? `, with ${combo.extras.map(name).join(' + ')}` : ''
          }`
        }
        glyphExtras={(combo) => [yarnId, ...combo.extras]}
      />
    </>
  )
}

import { useMemo } from 'react'
import { yarnCombinations } from '../../core/schema'
import { useTable } from '../../app/hooks'
import { ColourCombinationCard } from '../../ui/ColourCombinationCard'

/**
 * The colour combinations a yarn has gone into, as main and as extra — mounted under the yarn's
 * detail view. Aggregated from `squares` at read time (`yarnCombinations`), so there is nothing to
 * keep in sync: change a square's colours and this follows.
 */
export function YarnCombinations({ yarnId }: { yarnId: string }) {
  const squares = useTable('squares')
  const combos = useMemo(() => (squares ? yarnCombinations(squares, yarnId) : null), [squares, yarnId])
  if (!combos) return null

  // Each glyph draws the whole square, this yarn included, in its real role, so an extra row shows
  // this yarn as a wedge. The text names only the partners, since this yarn is what the page is about.
  return (
    <>
      <ColourCombinationCard
        title="Used as main"
        items={combos.asMain}
        empty="No square uses this as its main colour yet."
        describe={(combo, name) =>
          combo.extras.length > 0 ? `with ${combo.extras.map(name).join(' + ')}` : 'On its own'
        }
      />
      <ColourCombinationCard
        title="Used as extra"
        items={combos.asExtra}
        empty="No square uses this as an extra colour yet."
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

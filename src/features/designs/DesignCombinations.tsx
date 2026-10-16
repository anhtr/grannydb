import { useMemo } from 'react'
import { designCombinations } from '../../core/schema'
import { useTable } from '../../app/hooks'
import { ColourCombinationCard } from '../../ui/ColourCombinationCard'

/**
 * The squares made from a design, grouped by the colours they were worked in — mounted under the
 * design's detail view. Aggregated from `squares` at read time (`designCombinations`), like the
 * yarn view's combinations.
 */
export function DesignCombinations({ designId }: { designId: string }) {
  const squares = useTable('squares')
  const combos = useMemo(() => (squares ? designCombinations(squares, designId) : null), [squares, designId])
  if (!combos) return null

  return (
    <ColourCombinationCard
      title="Squares and colours"
      items={combos}
      empty="No square uses this design yet."
      describe={(combo, name) => {
        // Main first and named as such, since it is the colour that sets the square's look.
        if (!combo.main && combo.extras.length === 0) return '(no colours yet)'
        const main = combo.main ? `${name(combo.main)} main` : '(no main colour)'
        return combo.extras.length > 0 ? `${main}, with ${combo.extras.map(name).join(' + ')}` : main
      }}
    />
  )
}

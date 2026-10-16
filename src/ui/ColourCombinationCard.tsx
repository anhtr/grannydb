import type { ReactNode } from 'react'
import { titleFor } from '../core/schema'
import type { ColourCombination } from '../core/schema'
import { useLookup, useTableSchema } from '../app/hooks'
import { Card, ColourGlyph, Link } from './components'

/**
 * A card of colour combinations — glyph, a line naming the colours, a square count, and a link to
 * each square — shared by the yarn and design detail views. What the line says differs by page (a
 * yarn names its partners; a design names every colour), so the caller supplies `describe`, and
 * `glyphExtras` says which extras to draw when the combination leaves one out.
 */
export function ColourCombinationCard({
  title,
  items,
  empty,
  describe,
  glyphExtras = (combo) => combo.extras,
}: {
  title: string
  items: ColourCombination[]
  empty: string
  describe: (combo: ColourCombination, name: (yarnId: string) => string) => ReactNode
  glyphExtras?: (combo: ColourCombination) => string[]
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

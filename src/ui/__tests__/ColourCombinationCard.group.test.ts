import { describe, expect, it } from 'vitest'
import { groupSquares } from '../ColourCombinationCard'

describe('groupSquares', () => {
  const types: Record<string, string> = { S1: 'holey', S2: 'solid', S3: 'holey', S4: '', S5: 'lace' }
  const of = (id: string) => types[id] ?? ''

  it('buckets by group in the given order, unknown groups after known ones, blank last', () => {
    expect(groupSquares(['S1', 'S2', 'S3', 'S4', 'S5'], { of, order: ['solid', 'holey'] })).toEqual([
      ['solid', ['S2']],
      ['holey', ['S1', 'S3']],
      ['lace', ['S5']],
      ['', ['S4']],
    ])
  })

  it('keeps square order within a group', () => {
    expect(groupSquares(['S3', 'S1'], { of, order: ['solid', 'holey'] })).toEqual([['holey', ['S3', 'S1']]])
  })
})

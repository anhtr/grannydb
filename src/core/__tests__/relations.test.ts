import { describe, expect, it } from 'vitest'
import { designCombinations, designSquareCounts, identicalSquares, isYarnActive, referencesTo, squareYarnIds, stashStats, yarnCombinations, yarnUsageCounts } from '../schema/relations'
import type { CsvTable } from '../csv'
import type { SchemaSet } from '../schema'

const squares: CsvTable = {
  columns: ['id', 'design_id', 'main_yarn', 'extra_yarns'],
  rows: [
    { id: 'S001', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
    { id: 'S002', design_id: 'D1', main_yarn: 'Y2', extra_yarns: '' },
    { id: 'S003', design_id: 'D2', main_yarn: 'Y1', extra_yarns: 'Y2' },
    { id: 'S004', design_id: '', main_yarn: '', extra_yarns: '' },
  ],
}

describe('squareYarnIds', () => {
  it('lists the main colour first, then the extras', () => {
    expect(squareYarnIds(squares.rows[0])).toEqual(['Y1', 'Y2', 'Y3'])
  })

  it('names a yarn once even when it is both main and extra', () => {
    expect(squareYarnIds({ id: 'S9', main_yarn: 'Y1', extra_yarns: 'Y2;Y1' })).toEqual(['Y1', 'Y2'])
  })

  it('is empty for a square with no colours', () => {
    expect(squareYarnIds(squares.rows[3])).toEqual([])
  })
})

describe('yarnUsageCounts', () => {
  it('counts a yarn once per square it is the main colour of', () => {
    expect(yarnUsageCounts(squares).get('Y1')).toEqual({ main: 2, extra: 0 })
  })

  it('counts a yarn once per square it appears among the extra colours of', () => {
    expect(yarnUsageCounts(squares).get('Y2')).toEqual({ main: 1, extra: 2 })
  })

  it('counts a yarn that only ever appears as an extra colour', () => {
    expect(yarnUsageCounts(squares).get('Y3')).toEqual({ main: 0, extra: 1 })
  })

  it('omits a yarn no square references', () => {
    expect(yarnUsageCounts(squares).has('Y9')).toBe(false)
  })

  it('ignores blank main_yarn and extra_yarns cells', () => {
    const counts = yarnUsageCounts(squares)
    expect([...counts.keys()]).not.toContain('')
  })
})

describe('stashStats', () => {
  const yarns: CsvTable = {
    columns: ['id', 'hex', 'skeins', 'partial_skein', 'is_too_low'],
    rows: [
      { id: 'Y1', hex: '#ffffff', skeins: '2', partial_skein: 'yes', is_too_low: 'no' },
      { id: 'Y2', hex: '', skeins: '0', partial_skein: 'no', is_too_low: 'yes' },
      { id: 'Y3', hex: '#000000', skeins: '0.1', partial_skein: 'no', is_too_low: 'no' },
      { id: 'Y4', hex: ' ', skeins: '', partial_skein: 'no', is_too_low: 'no' },
      { id: 'Y5', hex: '#123456;#abcdef', skeins: '0.2', partial_skein: 'no', is_too_low: 'no' },
      { id: 'Y6', hex: '#111111', skeins: '-3', partial_skein: 'yes', is_too_low: '' },
      { id: 'Y7', hex: '#222222', skeins: 'lots', partial_skein: 'no', is_too_low: 'no' },
    ],
  }

  it('adds up what is on hand, counting a started skein apart from the whole ones', () => {
    // 2 + 0.1 + 0.2, and not 2.3000000000000003. The negative and the non-number count as none.
    expect(stashStats(yarns, squares)).toMatchObject({ yarns: 7, skeins: 2.3, inStock: 3, started: 2 })
  })

  it('lists the yarns flagged too low and those with no colour recorded', () => {
    const stats = stashStats(yarns, squares)
    expect(stats.tooLow).toEqual(['Y2'])
    expect(stats.noColour).toEqual(['Y2', 'Y4'])
  })

  it('lists the yarns no square uses, those with yarn on hand first', () => {
    // Y1 to Y3 are used by the squares above. Y5 has a part skein and Y6 a started one.
    const stats = stashStats(yarns, squares)
    expect(stats.unused).toEqual(['Y5', 'Y6', 'Y4', 'Y7'])
    expect(stats.unusedOnHand).toBe(2)
  })

  it('is all zeroes for an empty stash', () => {
    expect(stashStats({ columns: ['id'], rows: [] }, squares)).toEqual({
      yarns: 0,
      skeins: 0,
      inStock: 0,
      started: 0,
      tooLow: [],
      unused: [],
      unusedOnHand: 0,
      noColour: [],
    })
  })
})

describe('isYarnActive', () => {
  it('is active with a positive skein count, regardless of usage', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '2', partial_skein: 'no' }, undefined)).toBe(true)
  })

  it('is active with a partial skein even at zero full skeins', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'yes' }, undefined)).toBe(true)
  })

  it('is active when used by a square as main or extra, even with nothing left in stash', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 1, extra: 0 })).toBe(true)
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 0, extra: 1 })).toBe(true)
  })

  it('is inactive with nothing in stash and no using square', () => {
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, undefined)).toBe(false)
    expect(isYarnActive({ id: 'Y1', skeins: '0', partial_skein: 'no' }, { main: 0, extra: 0 })).toBe(false)
  })
})

describe('designSquareCounts', () => {
  it('counts squares per design', () => {
    const counts = designSquareCounts(squares)
    expect(counts.get('D1')).toBe(2)
    expect(counts.get('D2')).toBe(1)
  })

  it('does not count squares with no design', () => {
    expect(designSquareCounts(squares).has('')).toBe(false)
  })
})

describe('yarnCombinations', () => {
  const mixed: CsvTable = {
    columns: ['id', 'main_yarn', 'extra_yarns'],
    rows: [
      { id: 'S001', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
      { id: 'S002', main_yarn: 'Y1', extra_yarns: 'Y3;Y2' },
      { id: 'S003', main_yarn: 'Y1', extra_yarns: '' },
      { id: 'S004', main_yarn: 'Y4', extra_yarns: 'Y1' },
      { id: 'S005', main_yarn: 'Y4', extra_yarns: 'Y3;Y1' },
      { id: 'S006', main_yarn: 'Y2', extra_yarns: 'Y5' },
    ],
  }

  it('groups squares where the yarn is main by their extras, regardless of extra order', () => {
    expect(yarnCombinations(mixed, 'Y1').asMain).toEqual([
      { main: 'Y1', extras: ['Y2', 'Y3'], squareIds: ['S001', 'S002'] },
      { main: 'Y1', extras: [], squareIds: ['S003'] },
    ])
  })

  it('groups squares where the yarn is extra by main and the other extras, leaving the yarn out', () => {
    expect(yarnCombinations(mixed, 'Y1').asExtra).toEqual([
      { main: 'Y4', extras: [], squareIds: ['S004'] },
      { main: 'Y4', extras: ['Y3'], squareIds: ['S005'] },
    ])
  })

  it('counts a yarn listed as both main and extra on one square under main only', () => {
    const table: CsvTable = { columns: ['id', 'main_yarn', 'extra_yarns'], rows: [{ id: 'S1', main_yarn: 'Y1', extra_yarns: 'Y1;Y2' }] }
    expect(yarnCombinations(table, 'Y1')).toEqual({
      asMain: [{ main: 'Y1', extras: ['Y2'], squareIds: ['S1'] }],
      asExtra: [],
    })
  })

  it('returns nothing for a yarn no square uses', () => {
    expect(yarnCombinations(mixed, 'Y9')).toEqual({ asMain: [], asExtra: [] })
  })
})

describe('designCombinations', () => {
  const table: CsvTable = {
    columns: ['id', 'design_id', 'main_yarn', 'extra_yarns'],
    rows: [
      { id: 'S001', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y3;Y2' },
      { id: 'S002', design_id: 'D1', main_yarn: 'Y2', extra_yarns: '' },
      { id: 'S003', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y2;Y3;Y2' },
      { id: 'S004', design_id: 'D1', main_yarn: '', extra_yarns: '' },
      { id: 'S005', design_id: 'D2', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
    ],
  }

  it("groups only this design's squares by main and the set of extras, most-used first", () => {
    expect(designCombinations(table, 'D1')).toEqual([
      { main: 'Y1', extras: ['Y2', 'Y3'], squareIds: ['S001', 'S003'] },
      { main: '', extras: [], squareIds: ['S004'] },
      { main: 'Y2', extras: [], squareIds: ['S002'] },
    ])
  })

  it('returns nothing for a design no square cites', () => {
    expect(designCombinations(table, 'D9')).toEqual([])
  })
})

describe('identicalSquares', () => {
  const table: CsvTable = {
    columns: ['id', 'status', 'design_id', 'main_yarn', 'extra_yarns'],
    rows: [
      { id: 'S001', status: 'blocked', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
      { id: 'S002', status: 'planned', design_id: 'D1', main_yarn: 'Y1', extra_yarns: 'Y3;Y2' },
      { id: 'S003', status: 'done', design_id: 'D1', main_yarn: 'Y2', extra_yarns: 'Y1;Y3' },
      { id: 'S004', status: 'done', design_id: 'D2', main_yarn: 'Y1', extra_yarns: 'Y2;Y3' },
      { id: 'S005', status: 'in progress', design_id: '', main_yarn: 'Y1', extra_yarns: '' },
      { id: 'S006', status: 'done', design_id: '', main_yarn: 'Y1', extra_yarns: '' },
    ],
  }

  it('groups squares with the same design, main and set of extras, across every status', () => {
    const groups = identicalSquares(table)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ designId: 'D1', main: 'Y1', extras: ['Y2', 'Y3'] })
    expect(groups[0].squares.map((r) => r.id)).toEqual(['S001', 'S002'])
  })

  it('leaves out squares with no design or no main colour', () => {
    expect(identicalSquares(table).flatMap((g) => g.squares.map((r) => r.id))).not.toContain('S005')
  })

  it('returns nothing when every square is unique', () => {
    expect(identicalSquares({ ...table, rows: table.rows.slice(2, 4) })).toEqual([])
  })
})

describe('referencesTo', () => {
  const schemas = {
    order: ['squares', 'yarns'],
    tables: {
      squares: {
        table: 'squares',
        idField: 'id',
        fields: [
          { key: 'id', label: 'ID', type: 'id' },
          { key: 'main_yarn', label: 'Main colour', type: 'ref', refTable: 'yarns' },
          { key: 'extra_yarns', label: 'Extra colours', type: 'reflist', refTable: 'yarns' },
        ],
      },
      yarns: { table: 'yarns', idField: 'id', fields: [{ key: 'id', label: 'ID', type: 'id' }] },
    },
  } as unknown as SchemaSet

  it('lists the rows naming a record, field by field, through ref and reflist alike', () => {
    const refs = referencesTo(schemas, { squares }, 'yarns', 'Y2')
    expect(refs.map((r) => [r.field.key, r.rowIds])).toEqual([
      ['main_yarn', ['S002']],
      ['extra_yarns', ['S001', 'S003']],
    ])
  })

  it('matches a hand-edited reference with stray spaces, the way validation reads it', () => {
    const spaced: CsvTable = { columns: squares.columns, rows: [{ id: 'S009', main_yarn: ' Y9 ', extra_yarns: 'Y1; Y9' }] }
    const refs = referencesTo(schemas, { squares: spaced }, 'yarns', 'Y9')
    expect(refs.map((r) => [r.field.key, r.rowIds])).toEqual([
      ['main_yarn', ['S009']],
      ['extra_yarns', ['S009']],
    ])
  })

  it('does not match an id that is only a prefix of another', () => {
    expect(referencesTo(schemas, { squares }, 'yarns', 'Y')).toEqual([])
  })

  it('is empty for a record nothing points at', () => {
    expect(referencesTo(schemas, { squares }, 'yarns', 'Y9')).toEqual([])
  })
})

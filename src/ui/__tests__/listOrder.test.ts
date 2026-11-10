import { describe, expect, it } from 'vitest'
import { neighbours, recordOrder, rememberListOrder } from '../listOrder'

describe('neighbours', () => {
  const order = ['S003', 'S001', 'S002']

  it('finds the records either side, in the order given', () => {
    expect(neighbours(order, 'S001')).toEqual({ position: 2, total: 3, previous: 'S003', next: 'S002' })
  })

  it('has nothing before the first or after the last', () => {
    expect(neighbours(order, 'S003')).toMatchObject({ position: 1, previous: null, next: 'S001' })
    expect(neighbours(order, 'S002')).toMatchObject({ position: 3, previous: 'S001', next: null })
  })

  it('offers nothing for a record that is not in the list', () => {
    expect(neighbours(order, 'S009')).toBeNull()
    expect(neighbours([], 'S001')).toBeNull()
  })
})

describe('recordOrder', () => {
  it('falls back to id order, numerically, for a list not opened this session', () => {
    expect(recordOrder('never-opened', ['S10', 'S9', 'S1'])).toEqual(['S1', 'S9', 'S10'])
  })

  it('uses the order the list was last shown in', () => {
    rememberListOrder('squares', ['S003', 'S001'])
    // S002 exists but the list had filtered it out, so it is not stepped through.
    expect(recordOrder('squares', ['S001', 'S002', 'S003'])).toEqual(['S003', 'S001'])
  })

  it('drops records deleted since the list was shown', () => {
    rememberListOrder('yarns', ['Y3', 'Y1', 'Y2'])
    expect(recordOrder('yarns', ['Y2', 'Y3'])).toEqual(['Y3', 'Y2'])
  })

  it('keeps each table to its own order', () => {
    rememberListOrder('designs', ['D2', 'D1'])
    rememberListOrder('sources', ['R1'])
    expect(recordOrder('designs', ['D1', 'D2'])).toEqual(['D2', 'D1'])
  })
})

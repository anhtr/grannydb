import { describe, expect, it } from 'vitest'
import { matchRoute, resolveRoute, routeSection } from '../../app/router'

describe('matchRoute', () => {
  it('matches a literal path', () => {
    expect(matchRoute('/squares', '/squares')).toEqual({})
  })

  it('captures params', () => {
    expect(matchRoute('/:table/:id', '/squares/S001')).toEqual({ table: 'squares', id: 'S001' })
  })

  it('rejects a different depth', () => {
    expect(matchRoute('/:table/:id', '/squares')).toBeNull()
    expect(matchRoute('/:table/:id', '/squares/S001/edit')).toBeNull()
  })

  it('decodes an encoded segment', () => {
    expect(matchRoute('/:table/:id', '/squares/S%20001')).toEqual({ table: 'squares', id: 'S 001' })
  })

  it('does not let a literal be shadowed by a param at the same position', () => {
    expect(matchRoute('/squares/new', '/squares/S001')).toBeNull()
  })
})

describe('resolveRoute', () => {
  const routes = [
    { pattern: '/:table/new', value: 'new' },
    { pattern: '/:table/:id/edit', value: 'edit' },
    { pattern: '/:table/:id', value: 'detail' },
    { pattern: '/:table', value: 'list' },
  ]

  it('prefers the first matching pattern, so order encodes specificity', () => {
    expect(resolveRoute(routes, '/squares/new')?.value).toBe('new')
    expect(resolveRoute(routes, '/squares/S001')?.value).toBe('detail')
    expect(resolveRoute(routes, '/squares/S001/edit')?.value).toBe('edit')
    expect(resolveRoute(routes, '/squares')?.value).toBe('list')
  })

  it('returns null when nothing matches', () => {
    expect(resolveRoute(routes, '/a/b/c/d')).toBeNull()
  })
})

describe('routeSection', () => {
  it('reads the top-level section for nav highlighting', () => {
    expect(routeSection('/squares/S001/edit')).toBe('squares')
    expect(routeSection('/')).toBe('')
  })
})

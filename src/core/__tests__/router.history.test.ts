// @vitest-environment jsdom
/**
 * The router's history behaviour, which needs a `window`: pushing entries without a fragment
 * navigation, stepping back only to the page that is actually behind you, and the unsaved-changes
 * guard a form installs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goBack, navigate, setLeaveGuard } from '../../app/router'

beforeEach(() => {
  navigate('/start')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('navigate', () => {
  it('pushes a history entry and announces it as a hash change', () => {
    const heard = vi.fn()
    window.addEventListener('hashchange', heard)
    const before = window.history.length
    navigate('/squares/S001')
    window.removeEventListener('hashchange', heard)

    expect(window.location.hash).toBe('#/squares/S001')
    expect(window.history.length).toBe(before + 1)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('replaces instead of pushing when asked', () => {
    navigate('/squares/S001')
    const before = window.history.length
    navigate('/squares/S002', { replace: true })
    expect(window.location.hash).toBe('#/squares/S002')
    expect(window.history.length).toBe(before)
  })

  it('does nothing for the page already shown', () => {
    navigate('/squares')
    const before = window.history.length
    navigate('/squares')
    expect(window.history.length).toBe(before)
  })

  it('stays put when the leave guard says no, and goes when it says yes', () => {
    navigate('/squares/S001/edit')
    let allow = false
    const clear = setLeaveGuard(() => allow)

    navigate('/squares')
    expect(window.location.hash).toBe('#/squares/S001/edit')

    allow = true
    navigate('/squares')
    expect(window.location.hash).toBe('#/squares')
    clear()
  })
})

describe('goBack', () => {
  it('steps back through history when the target is the page just left', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    navigate('/yarns')
    navigate('/yarns/Y01')
    goBack('/yarns')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('navigates forward to the target when something else is behind', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    navigate('/squares/S001')
    navigate('/yarns/Y01')
    goBack('/yarns')
    expect(back).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/yarns')
  })

  it('asks the leave guard before stepping back', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    navigate('/yarns')
    navigate('/yarns/Y01/edit')
    const clear = setLeaveGuard(() => false)
    goBack('/yarns')
    clear()
    expect(back).not.toHaveBeenCalled()
  })
})

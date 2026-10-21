// @vitest-environment jsdom
/**
 * The router's history behaviour, which needs a `window`: pushing entries without a fragment
 * navigation, stepping back only to the page that is actually behind you, and the unsaved-changes
 * guard a form installs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goBack, navigate, setLeaveGuard } from '../../app/router'

/** Resolves once the browser has finished a history traversal (jsdom traverses asynchronously). */
function nextTraversal(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
}

async function browserBack(): Promise<void> {
  const done = nextTraversal()
  window.history.back()
  await done
}

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

  it('treats a replaced page as still having the same page behind it', () => {
    // list → new record → saved (the form replaces "new" with the record) → back to the list
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    navigate('/squares')
    navigate('/squares/new')
    navigate('/squares/S010', { replace: true })
    goBack('/squares')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('does not step back to whatever page the browser came from on its own Back', async () => {
    // Settings → yarn → Yarns tab → browser Back: the entry behind the yarn is Settings, not Yarns,
    // even though Yarns is the page shown just before. Stepping back would land on Settings.
    navigate('/settings')
    navigate('/yarns/Y01')
    navigate('/yarns')
    await browserBack()
    expect(window.location.hash).toBe('#/yarns/Y01')

    const back = vi.spyOn(window.history, 'back')
    goBack('/yarns')
    expect(back).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/yarns')
  })

  it('steps back for real when the entry behind is the target, after a traversal too', async () => {
    navigate('/yarns')
    navigate('/yarns/Y01')
    navigate('/yarns/Y01/edit')
    await browserBack()
    expect(window.location.hash).toBe('#/yarns/Y01')

    const done = nextTraversal()
    goBack('/yarns')
    await done
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

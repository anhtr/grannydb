import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../prefs'

/** Just enough of `localStorage` for one key, since these run in Node. */
function stubStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  })
  return items
}

afterEach(() => vi.unstubAllGlobals())

describe('prefs', () => {
  it('starts from the defaults: synced automatically, drawn as the device asks', () => {
    stubStorage()
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.theme).toBe('system')
  })

  it('reads back what it saved', () => {
    stubStorage()
    savePrefs({ ...DEFAULT_PREFS, autoSync: false, theme: 'dark' })
    expect(loadPrefs()).toMatchObject({ autoSync: false, theme: 'dark' })
  })

  it('reads prefs saved before there was a theme, and a theme it does not know, as "system"', () => {
    stubStorage({ 'grannydb.prefs': JSON.stringify({ lists: {}, autoSync: false }) })
    expect(loadPrefs()).toMatchObject({ autoSync: false, theme: 'system' })
    stubStorage({ 'grannydb.prefs': JSON.stringify({ lists: {}, theme: 'sepia' }) })
    expect(loadPrefs().theme).toBe('system')
  })

  it('falls back to the defaults when storage holds something unreadable or is not there at all', () => {
    stubStorage({ 'grannydb.prefs': '{not json' })
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    vi.unstubAllGlobals()
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })
})

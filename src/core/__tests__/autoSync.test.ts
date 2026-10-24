import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubError, NetworkError } from '../github/client'
import { DEFAULT_PREFS } from '../prefs'
import { AUTO_SYNC_IDLE_MS, autoSyncBlocker, autoSyncDelay, isWorthReporting } from '../store/autoSync'
import { upsertChange } from '../store/queue'
import { appStore } from '../store'
import { buildBundle } from '../../../scripts/build-data'

vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
    del: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
  }
})

const ready = {
  prefs: DEFAULT_PREFS,
  token: 'github_pat_x',
  changes: [upsertChange('squares', 'S001', { id: 'S001', notes: 'x' })],
  syncing: false,
  online: true,
}

describe('when an automatic sync may run', () => {
  it('runs with a token, a queue, a connection and nothing in flight', () => {
    expect(autoSyncBlocker(ready)).toBeNull()
  })

  it('names what stops it', () => {
    expect(autoSyncBlocker({ ...ready, prefs: { ...DEFAULT_PREFS, autoSync: false } })).toBe('off')
    expect(autoSyncBlocker({ ...ready, token: null })).toBe('no-token')
    expect(autoSyncBlocker({ ...ready, changes: [] })).toBe('nothing-queued')
    expect(autoSyncBlocker({ ...ready, syncing: true })).toBe('busy')
    expect(autoSyncBlocker({ ...ready, online: false })).toBe('offline')
  })

  it('waits out a burst of edits, but not a reconnect or leaving the app', () => {
    expect(autoSyncDelay('edit')).toBe(AUTO_SYNC_IDLE_MS)
    expect(autoSyncDelay('online')).toBe(0)
    expect(autoSyncDelay('hidden')).toBe(0)
    expect(autoSyncDelay('start')).toBe(0)
  })

  it('stays quiet about being offline, and about nothing else', () => {
    expect(isWorthReporting(new NetworkError('https://api.github.com/x', new TypeError('x')))).toBe(false)
    expect(isWorthReporting(new GitHubError('Bad credentials', 401, 'https://api.github.com/x'))).toBe(true)
    expect(isWorthReporting(new Error('Sync failed after repeated attempts.'))).toBe(true)
  })
})

describe('the store pushing on its own', () => {
  const { bundle } = buildBundle('src/core/__tests__/fixtures/data')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })

  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
    vi.useRealTimers()
  })

  it('makes one attempt per burst, keeps the queue offline, and reports nothing', async () => {
    // Load once online to seed the device's copy, then sign in on a plane.
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(bundle), { status: 200 }))
    await appStore.init()
    const offline = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    globalThis.fetch = offline as unknown as typeof fetch
    await appStore.setToken('github_pat_x')
    expect(appStore.getState().snapshot?.source).toBe('cache')
    offline.mockClear()

    vi.useFakeTimers()
    await appStore.save('squares', 'FS1', { notes: 'one' })
    await appStore.save('squares', 'FS1', { notes: 'two' })
    await appStore.save('squares', 'FS1', { position: 'r1c1' })
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_MS - 1)
    expect(offline).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    // One attempt for three edits; it fails at the first request, the ref lookup.
    expect(offline).toHaveBeenCalledTimes(1)
    expect(appStore.getState().syncing).toBe(false)
    expect(appStore.getState().syncError).toBeNull()
    expect(appStore.getState().changes).toHaveLength(1)

    // The same failure from the button is reported: you asked, so you get an answer.
    await appStore.sync()
    expect(appStore.getState().syncError).toMatch(/offline/)
  })

  it('does nothing on its own once turned off', async () => {
    const calls = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    globalThis.fetch = calls as unknown as typeof fetch
    appStore.setPrefs({ ...appStore.getState().prefs, autoSync: false })

    vi.useFakeTimers()
    await appStore.save('squares', 'FS1', { notes: 'three' })
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_MS * 4)
    expect(calls).not.toHaveBeenCalled()
  })
})

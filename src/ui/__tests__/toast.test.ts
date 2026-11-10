import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentToast,
  dismissToast,
  holdToast,
  notify,
  releaseToast,
  subscribeToasts,
  syncMessage,
  TOAST_MS,
  TOAST_WITH_ACTION_MS,
} from '../toast'
import type { SyncGlimpse } from '../toast'

describe('notify', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    dismissToast()
    vi.useRealTimers()
  })

  it('shows a message and takes it away again by itself', () => {
    notify('Saved square S001')
    expect(currentToast()).toMatchObject({ message: 'Saved square S001', tone: 'ok' })
    vi.advanceTimersByTime(TOAST_MS)
    expect(currentToast()).toBeNull()
  })

  it('keeps a message with a button on it for longer', () => {
    notify('Deleted square S001', { action: { label: 'Undo', run: () => {} } })
    vi.advanceTimersByTime(TOAST_MS)
    expect(currentToast()).not.toBeNull()
    vi.advanceTimersByTime(TOAST_WITH_ACTION_MS - TOAST_MS)
    expect(currentToast()).toBeNull()
  })

  it('replaces the message showing, and the old timer does not close the new one', () => {
    notify('first')
    vi.advanceTimersByTime(TOAST_MS - 1000)
    notify('second')
    vi.advanceTimersByTime(1000)
    expect(currentToast()?.message).toBe('second')
  })

  it('gives the same words a new id, so they are announced again', () => {
    notify('Saved')
    const first = currentToast()?.id
    notify('Saved')
    expect(currentToast()?.id).not.toBe(first)
  })

  it('only dismisses by id the message that id belongs to', () => {
    notify('first')
    const first = currentToast()!.id
    notify('second')
    dismissToast(first)
    expect(currentToast()?.message).toBe('second')
  })

  it('stops the clock while held and restarts it on release', () => {
    notify('Deleted', { action: { label: 'Undo', run: () => {} } })
    holdToast()
    vi.advanceTimersByTime(TOAST_WITH_ACTION_MS * 3)
    expect(currentToast()).not.toBeNull()
    releaseToast()
    vi.advanceTimersByTime(TOAST_WITH_ACTION_MS)
    expect(currentToast()).toBeNull()
  })

  it('tells subscribers when the message changes', () => {
    const seen: (string | null)[] = []
    const stop = subscribeToasts(() => seen.push(currentToast()?.message ?? null))
    notify('one')
    dismissToast()
    stop()
    notify('two')
    expect(seen).toEqual(['one', null])
  })
})

describe('syncMessage', () => {
  const idle: SyncGlimpse = { syncing: false, syncError: null, lastSyncAt: 100, lastSyncCount: 2 }
  const busy: SyncGlimpse = { ...idle, syncing: true }

  it('says nothing unless a sync has just ended', () => {
    expect(syncMessage(idle, idle)).toBeNull()
    expect(syncMessage(idle, busy)).toBeNull()
    expect(syncMessage(busy, busy)).toBeNull()
  })

  it('counts what a finished sync pushed', () => {
    expect(syncMessage(busy, { ...idle, lastSyncAt: 200, lastSyncCount: 3 })).toEqual({
      message: 'Synced 3 changes',
      tone: 'ok',
    })
    expect(syncMessage(busy, { ...idle, lastSyncAt: 200, lastSyncCount: 1 })?.message).toBe('Synced 1 change')
  })

  it('reports a failure that left an error behind', () => {
    expect(syncMessage(busy, { ...idle, syncError: 'Bad credentials' })).toEqual({
      message: 'Sync failed - see Pending changes',
      tone: 'warn',
    })
  })

  it('stays quiet about a failure the store chose not to report', () => {
    // An automatic push that could not reach GitHub: no error, no new last sync.
    expect(syncMessage(busy, idle)).toBeNull()
  })

  it('does not announce the last sync loaded from storage at startup', () => {
    const fresh: SyncGlimpse = { syncing: false, syncError: null, lastSyncAt: undefined, lastSyncCount: 0 }
    expect(syncMessage(fresh, idle)).toBeNull()
  })
})

import type { CsvRow, CsvTable } from '../csv'
import { findRow, nextId } from '../csv'
import type { SchemaSet, TableSchema } from '../schema'
import {
  checkConnection,
  clearToken as clearStoredToken,
  DEFAULT_CONFIG,
  loadConfig,
  loadToken,
  readSnapshot,
  saveConfig,
  saveToken as saveStoredToken,
} from '../github'
import type { ConnectionCheck, RepoConfig, Snapshot } from '../github'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../prefs'
import type { Prefs } from '../prefs'
import { applyChanges } from './merge'
import {
  appendChange,
  clearQueue,
  deleteChange,
  isQueueDurable,
  loadQueue,
  saveQueue,
  upsertChange,
} from './queue'
import type { Change } from './queue'
import { clearSnapshot, loadSnapshot, saveSnapshot } from './snapshotCache'
import { loadLastSync, saveLastSync, syncChanges } from './sync'
import type { LastSync, SyncResult } from './sync'

export interface AppState {
  phase: 'loading' | 'ready' | 'error'
  snapshot: Snapshot | null
  /** Base data with the queue replayed on top. What every screen renders. */
  data: Record<string, CsvTable>
  changes: Change[]
  /**
   * False once a queue write has failed, i.e. unsynced edits are memory-only for this session.
   * Surfaced rather than swallowed: local-first is a promise that edits survive a refresh.
   */
  queueDurable: boolean
  error: string | null
  /**
   * What the browser thinks about connectivity. It reports whether there is a network interface,
   * not whether GitHub is reachable — true on a captive portal, true on a plane's wifi with no
   * uplink — so it drives hints and a reconnect re-read, never a decision about whether to try.
   */
  online: boolean
  /** A newer build is installed and waiting; the app is running the previously cached one. */
  updateReady: boolean
  syncing: boolean
  syncError: string | null
  lastSync: LastSync | null
  token: string | null
  config: RepoConfig
  prefs: Prefs
}

const initialState: AppState = {
  phase: 'loading',
  snapshot: null,
  data: {},
  changes: [],
  queueDurable: true,
  error: null,
  online: true,
  updateReady: false,
  syncing: false,
  syncError: null,
  lastSync: null,
  token: null,
  config: DEFAULT_CONFIG,
  prefs: DEFAULT_PREFS,
}

type Listener = () => void

/**
 * A tiny observable store, read by React through `useSyncExternalStore`.
 *
 * Deliberately not a state library: the whole app has one dataset, one queue and one sync
 * operation, and keeping that in plain TypeScript means the interesting logic stays testable
 * without rendering anything.
 */
class AppStore {
  private state: AppState = initialState
  private listeners = new Set<Listener>()
  private loadTicket = 0

  getState = (): AppState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<AppState>): void {
    const next: AppState = { ...this.state, ...patch }
    // Keep the read model in step with its two inputs.
    if ((patch.snapshot !== undefined || patch.changes !== undefined) && next.snapshot) {
      next.data = applyChanges(next.snapshot.tables, next.snapshot.schemas, next.changes)
    }
    this.state = next
    for (const listener of this.listeners) listener()
  }

  async init(): Promise<void> {
    this.set({
      token: loadToken(),
      config: loadConfig(),
      prefs: loadPrefs(),
      lastSync: loadLastSync(),
      changes: await loadQueue(),
    })
    await this.reload()
  }

  async reload(): Promise<void> {
    const ticket = ++this.loadTicket
    const config = this.state.config
    this.set({ phase: 'loading', error: null })
    try {
      const snapshot = await readSnapshot(config, this.state.token)
      if (ticket !== this.loadTicket) return
      this.set({ snapshot, phase: 'ready', error: null })
      // Fire-and-forget: keeping the offline copy fresh must never be able to fail a load.
      void saveSnapshot(config, snapshot)
    } catch (error) {
      if (ticket !== this.loadTicket) return
      const message = error instanceof Error ? error.message : 'Could not load data.'

      // Every read path needs the network, so with no signal there is nothing to render and the
      // queued edits you made on the train become invisible. Falling back to the last dataset read
      // on this device keeps every screen working, marked `cache` so the staleness is visible
      // rather than implied. Replaying the queue on top is safe: a sync re-reads the repo fresh
      // before it commits, so these bytes never reach GitHub.
      const cached = await loadSnapshot(config)
      if (ticket !== this.loadTicket) return
      if (cached) {
        this.set({ snapshot: cached, phase: 'ready', error: null })
        return
      }
      this.set({ phase: 'error', error: message })
    }
  }

  /**
   * Re-read when the device comes back, and only re-read.
   *
   * Syncing stays a button you press — a read happening behind your back is invisible and
   * reversible, a commit to your repo is neither (see docs/04-sync-engine.md, "Why not auto-sync").
   * Guarded to the cases that are actually waiting on the network, because `online` fires on any
   * interface change and a needless reload throws away a perfectly good snapshot mid-scroll.
   */
  watchConnectivity(): () => void {
    if (typeof window === 'undefined') return () => {}

    const onOnline = (): void => {
      this.set({ online: true })
      if (this.state.snapshot?.source === 'cache' || this.state.phase === 'error') {
        void this.reload()
      }
    }
    const onOffline = (): void => this.set({ online: false })

    this.set({ online: navigator.onLine })
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }

  setUpdateReady(): void {
    this.set({ updateReady: true })
  }

  /** Forget the offline copy and read again, for when you want to be sure of what you are seeing. */
  async refreshFromGitHub(): Promise<void> {
    await clearSnapshot(this.state.config)
    await this.reload()
  }

  // Config and auth

  async setToken(token: string): Promise<void> {
    saveStoredToken(token)
    this.set({ token: token.trim() })
    await this.reload()
  }

  async signOut(): Promise<void> {
    clearStoredToken()
    this.set({ token: null })
    await this.reload()
  }

  async setConfig(config: RepoConfig): Promise<void> {
    saveConfig(config)
    this.set({ config })
    await this.reload()
  }

  setPrefs(prefs: Prefs): void {
    savePrefs(prefs)
    this.set({ prefs })
  }

  testConnection(): Promise<ConnectionCheck> {
    if (!this.state.token) {
      return Promise.resolve({ ok: false, message: 'No token saved yet.' })
    }
    return checkConnection(this.state.config, this.state.token)
  }

  // Reading

  get schemas(): SchemaSet | null {
    return this.state.snapshot?.schemas ?? null
  }

  schema(table: string): TableSchema | null {
    return this.state.snapshot?.schemas.tables[table] ?? null
  }

  table(name: string): CsvTable | null {
    return this.state.data[name] ?? null
  }

  row(table: string, id: string): CsvRow | null {
    const schema = this.schema(table)
    const data = this.table(table)
    if (!schema || !data) return null
    return findRow(data, schema.idField, id) ?? null
  }

  /** Next free id for a new record, e.g. S006. */
  nextIdFor(table: string): string {
    const schema = this.schema(table)
    const data = this.table(table)
    if (!schema || !data) return ''
    return nextId(data, schema.idField, schema.idPrefix, schema.idPadding)
  }

  // Writing

  /**
   * Queue an edit, recording only fields whose value actually changed.
   *
   * Diffing here rather than storing the whole row is what makes concurrent edits to different
   * fields of the same square merge instead of fighting.
   */
  async save(table: string, id: string, values: CsvRow): Promise<void> {
    const schema = this.schema(table)
    if (!schema) throw new Error(`Unknown table: ${table}`)

    const current = this.row(table, id)
    const diff: CsvRow = {}
    for (const [key, value] of Object.entries(values)) {
      if ((current?.[key] ?? '') !== value) diff[key] = value
    }
    if (current && Object.keys(diff).length === 0) return

    diff[schema.idField] = id
    await this.enqueue(upsertChange(table, id, diff))
  }

  async remove(table: string, id: string): Promise<void> {
    await this.enqueue(deleteChange(table, id))
  }

  private async enqueue(change: Change): Promise<void> {
    const changes = appendChange(this.state.changes, change)
    await saveQueue(changes)
    this.set({ changes, queueDurable: isQueueDurable() })
  }

  async discardChange(changeId: string): Promise<void> {
    const changes = this.state.changes.filter((c) => c.id !== changeId)
    await saveQueue(changes)
    this.set({ changes })
  }

  async discardAll(): Promise<void> {
    await clearQueue()
    this.set({ changes: [] })
  }

  // Syncing

  async sync(): Promise<SyncResult | null> {
    const { token, config, changes } = this.state
    if (!token) {
      this.set({ syncError: 'Add a GitHub token in Settings before syncing.' })
      return null
    }
    if (changes.length === 0 || this.state.syncing) return null

    this.set({ syncing: true, syncError: null })
    try {
      const result = await syncChanges(config, token, changes)

      // Only drop the changes we actually sent. Anything queued while the request was in flight
      // stays put rather than being silently thrown away.
      const sent = new Set(changes.map((c) => c.id))
      const remaining = this.state.changes.filter((c) => !sent.has(c.id))
      await saveQueue(remaining)

      const lastSync: LastSync = {
        at: Date.now(),
        sha: result.sha,
        paths: result.paths,
        changeCount: result.changeCount,
      }
      saveLastSync(lastSync)
      this.set({ changes: remaining, syncing: false, lastSync })
      await this.reload()
      return result
    } catch (error) {
      this.set({
        syncing: false,
        syncError: error instanceof Error ? error.message : 'Sync failed.',
      })
      return null
    }
  }
}

export const appStore = new AppStore()

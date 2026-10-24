/**
 * Whether the browser has agreed not to clear this origin's storage to free up space.
 *
 * By default IndexedDB is *best-effort*: under storage pressure the browser may delete it, and
 * Safari deletes script-written storage for a site not visited in seven days unless it is installed
 * to the home screen. For most sites that loses a cache. Here it would lose the queue — edits that
 * exist nowhere else. Asking for *persistent* storage takes the origin out of eviction.
 *
 * It is asked for on the first queued edit rather than on load: Firefox shows a prompt, and the
 * moment there is something unsynced to protect is the moment the question makes sense. Chrome
 * decides silently (an installed app is granted), Safari grants it to home-screen apps.
 */
export type StoragePersistence = 'persistent' | 'best-effort' | 'unsupported'

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined') return null
  const storage = navigator.storage as StorageManager | undefined
  return storage && typeof storage.persist === 'function' ? storage : null
}

/** Read the current state without prompting. */
export async function storagePersistence(): Promise<StoragePersistence> {
  const storage = storageManager()
  if (!storage) return 'unsupported'
  try {
    return (await storage.persisted()) ? 'persistent' : 'best-effort'
  } catch {
    return 'best-effort'
  }
}

/** Ask for persistence. May prompt (Firefox); a refusal just leaves storage best-effort. */
export async function requestPersistence(): Promise<StoragePersistence> {
  const storage = storageManager()
  if (!storage) return 'unsupported'
  try {
    return (await storage.persist()) ? 'persistent' : 'best-effort'
  } catch {
    return 'best-effort'
  }
}

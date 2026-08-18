import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncChanges } from '../store/sync'
import type { Change } from '../store/queue'
import type { RepoConfig } from '../github'

/**
 * Exercises the real commit protocol against a fake GitHub.
 *
 * This is the design's central claim — that a conflict is recoverable by replaying onto fresh data
 * rather than clobbering it — so it is worth testing against the actual request sequence rather
 * than trusting the prose.
 */

const config: RepoConfig = { owner: 'anhtr', repo: 'grannydb', branch: 'main', dataDir: 'data' }

const SCHEMAS = {
  'data/schema/tables.json': JSON.stringify({ version: 1, tables: ['squares', 'yarns'] }),
  'data/schema/squares.json': JSON.stringify({
    table: 'squares',
    file: 'data/squares.csv',
    label: 'Squares',
    labelSingular: 'Square',
    idField: 'id',
    idPrefix: 'S',
    idPadding: 3,
    titleField: 'id',
    fields: [
      { key: 'id', label: 'ID', type: 'id' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'position', label: 'Position', type: 'text' },
    ],
  }),
  'data/schema/yarns.json': JSON.stringify({
    table: 'yarns',
    file: 'data/yarns.csv',
    label: 'Yarns',
    labelSingular: 'Yarn',
    idField: 'id',
    idPrefix: 'Y',
    idPadding: 2,
    titleField: 'name',
    fields: [
      { key: 'id', label: 'ID', type: 'id' },
      { key: 'name', label: 'Name', type: 'text' },
    ],
  }),
}

/** A fake GitHub holding one branch, enough to satisfy the read and commit sequence. */
class FakeGitHub {
  head = 'commit-aaa'
  files: Record<string, string> = { ...SCHEMAS }
  /** Committed writes, in order: [{ message, files }]. */
  commits: { message: string; files: Record<string, string> }[] = []
  /**
   * Fires before every ref update, simulating another device landing a commit in that window.
   * Fires on each attempt; a one-shot test clears it from inside the callback.
   */
  onBeforeRefUpdate: (() => void) | null = null

  private pendingBlobs = new Map<string, string>()
  private pendingTrees = new Map<string, Record<string, string>>()
  private pendingCommits = new Map<string, { message: string; files: Record<string, string> }>()
  private counter = 0

  private id(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      return json({ object: { sha: this.head } })
    }

    if (method === 'GET' && path.includes('/contents/')) {
      const filePath = decodeURIComponent(path.split('/contents/')[1])
      const content = this.files[filePath]
      if (content === undefined) return json({ message: 'Not Found' }, 404)
      return new Response(content, { status: 200 })
    }

    if (method === 'GET' && path.includes('/git/commits/')) {
      return json({ tree: { sha: `tree-of-${path.split('/').pop()}` } })
    }

    if (method === 'POST' && path.endsWith('/git/blobs')) {
      const sha = this.id('blob')
      this.pendingBlobs.set(sha, Buffer.from(body.content, 'base64').toString('utf8'))
      return json({ sha })
    }

    if (method === 'POST' && path.endsWith('/git/trees')) {
      const sha = this.id('tree')
      const entries: Record<string, string> = {}
      for (const entry of body.tree) {
        entries[entry.path] = this.pendingBlobs.get(entry.sha) ?? ''
      }
      this.pendingTrees.set(sha, entries)
      return json({ sha })
    }

    if (method === 'POST' && path.endsWith('/git/commits')) {
      const sha = this.id('commit')
      this.pendingCommits.set(sha, {
        message: body.message,
        files: this.pendingTrees.get(body.tree) ?? {},
      })
      return json({ sha })
    }

    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      // The window where another device can land a commit.
      this.onBeforeRefUpdate?.()

      const commit = this.pendingCommits.get(body.sha)
      if (!commit) return json({ message: 'Unknown commit' }, 422)

      // The real compare-and-swap: our commit's parent must still be the head.
      const parentOk = this.expectedParent === this.head
      if (!parentOk) return json({ message: 'Update is not a fast forward' }, 422)

      this.commits.push(commit)
      Object.assign(this.files, commit.files)
      this.head = body.sha
      return json({ ref: 'refs/heads/main', object: { sha: body.sha } })
    }

    throw new Error(`FakeGitHub: unhandled ${method} ${path}`)
  }

  /** Parent recorded when the commit object was created; compared at ref-update time. */
  expectedParent = 'commit-aaa'

  setSquares(csv: string) {
    this.files['data/squares.csv'] = csv
  }

  setYarns(csv: string) {
    this.files['data/yarns.csv'] = csv
  }

  squares(): string {
    return this.files['data/squares.csv']
  }
}

let gh: FakeGitHub

function change(partial: Partial<Change> & Pick<Change, 'table' | 'rowId' | 'op'>): Change {
  return { id: `c-${Math.random()}`, ts: Date.now(), values: {}, ...partial }
}

beforeEach(() => {
  gh = new FakeGitHub()
  gh.setSquares('id,notes,position\nS001,first,\nS002,second,\n')
  gh.setYarns('id,name\nY01,Cream\n')
  // Track the parent the app claims, so the fake can enforce fast-forward-only.
  const originalFetch = gh.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST' && String(input).endsWith('/git/commits')) {
      gh.expectedParent = JSON.parse(String(init?.body)).parents[0]
    }
    return originalFetch(input, init)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncChanges', () => {
  it('writes one commit containing only the changed table', async () => {
    const result = await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'edited' } }),
    ])

    expect(result.status).toBe('committed')
    expect(gh.commits).toHaveLength(1)
    // yarns.csv was untouched, so it must not appear in the commit.
    expect(Object.keys(gh.commits[0].files)).toEqual(['data/squares.csv'])
    expect(gh.squares()).toBe('id,notes,position\nS001,edited,\nS002,second,\n')
  })

  it('writes both tables in a single commit when both changed', async () => {
    const result = await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S003', op: 'upsert', values: { notes: 'new' }, ts: 1 }),
      change({ table: 'yarns', rowId: 'Y02', op: 'upsert', values: { name: 'Sage' }, ts: 2 }),
    ])

    expect(result.status).toBe('committed')
    expect(gh.commits).toHaveLength(1)
    expect(Object.keys(gh.commits[0].files).sort()).toEqual(['data/squares.csv', 'data/yarns.csv'])
  })

  it('does nothing when the edit matches what is already there', async () => {
    const result = await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'first' } }),
    ])

    expect(result.status).toBe('nothing-to-do')
    expect(gh.commits).toHaveLength(0)
  })

  it('preserves a column the app has never heard of', async () => {
    gh.setSquares('id,notes,position,hook_size\nS001,first,,4.0mm\nS002,second,,3.5mm\n')

    await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'edited' } }),
    ])

    expect(gh.squares()).toBe(
      'id,notes,position,hook_size\nS001,edited,,4.0mm\nS002,second,,3.5mm\n',
    )
  })

  /**
   * The scenario the whole operation-log design exists for.
   */
  it('replays onto newer data when the branch moves mid-sync', async () => {
    // Between our read and our ref update, a laptop commits an edit to a different square.
    gh.onBeforeRefUpdate = () => {
      gh.setSquares('id,notes,position\nS001,first,\nS002,edited on laptop,\nS003,from laptop,\n')
      gh.head = 'commit-bbb'
    }

    const result = await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'from phone' } }),
    ])

    expect(result.status).toBe('committed')
    expect(result.attempts).toBe(2) // first attempt rejected, second replayed onto the new head

    // Both survive: ours applied, theirs untouched.
    expect(gh.squares()).toBe(
      'id,notes,position\nS001,from phone,\nS002,edited on laptop,\nS003,from laptop,\n',
    )
  })

  it('merges field-level edits to the same row from two devices', async () => {
    // The laptop sets `position` on the very square we are editing the notes of.
    gh.onBeforeRefUpdate = () => {
      gh.setSquares('id,notes,position\nS001,first,r1c1\nS002,second,\n')
      gh.head = 'commit-bbb'
    }

    await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'from phone' } }),
    ])

    // Our notes edit applied; their position survived, because the operation only carried `notes`.
    expect(gh.squares()).toBe('id,notes,position\nS001,from phone,r1c1\nS002,second,\n')
  })

  it('gives up after repeated conflicts rather than looping forever', async () => {
    // A branch that moves before every single ref update, so no attempt can ever land.
    let n = 0
    gh.onBeforeRefUpdate = () => {
      n += 1
      gh.head = `commit-moved-${n}`
    }

    await expect(
      syncChanges(config, 'tok', [
        change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'x' } }),
      ]),
    ).rejects.toThrow(/moved|fast forward/i)

    expect(gh.commits).toHaveLength(0)
  })

  it('applies a delete', async () => {
    await syncChanges(config, 'tok', [change({ table: 'squares', rowId: 'S002', op: 'delete' })])
    expect(gh.squares()).toBe('id,notes,position\nS001,first,\n')
  })

  it('reports nothing to do for an empty queue without touching the network', async () => {
    const result = await syncChanges(config, 'tok', [])
    expect(result.status).toBe('nothing-to-do')
    expect(gh.commits).toHaveLength(0)
  })

  it('reports validation issues alongside a successful commit', async () => {
    const result = await syncChanges(config, 'tok', [
      change({ table: 'squares', rowId: 'S001', op: 'upsert', values: { notes: 'ok' }, ts: 1 }),
      // A second row with the same id: committed, but flagged.
      change({ table: 'squares', rowId: '', op: 'upsert', values: { notes: 'no id' }, ts: 2 }),
    ])

    expect(result.status).toBe('committed')
    expect(result.issues.some((i) => i.message === 'row has no id')).toBe(true)
  })
})

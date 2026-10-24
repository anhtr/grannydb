/**
 * The web manifest's identity, resolved the way browsers resolve it.
 *
 * Worth a test because the mistake is invisible from inside this app and only shows up as a
 * neighbour's problem: this origin is shared with every other project page under the same
 * github.io user, and an app whose identity resolves to the origin root claims all of them, so
 * the browser will install only one. `id` is resolved against `start_url`'s *origin*, not against
 * the manifest URL like every other member — `"./"` means the root, not this app's directory.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MANIFEST_URL = 'https://anhtr.github.io/grannydb/manifest.webmanifest'

interface Manifest {
  id?: string
  start_url: string
  scope: string
}

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as Manifest

/** https://www.w3.org/TR/appmanifest/#id-member — absent means `start_url`. */
function identity(m: Manifest): string {
  const start = new URL(m.start_url, MANIFEST_URL)
  if (m.id === undefined) return start.href
  const id = new URL(m.id, start.origin)
  id.hash = ''
  return id.href
}

describe('the web manifest', () => {
  it('has an identity inside its own directory, not the shared origin root', () => {
    const scope = new URL(manifest.scope, MANIFEST_URL).href
    expect(scope).toBe('https://anhtr.github.io/grannydb/')
    expect(identity(manifest).startsWith(scope)).toBe(true)
  })

  it('keeps every URL relative, so a BASE_PATH build still resolves (invariant 5)', () => {
    for (const value of [manifest.start_url, manifest.scope, manifest.id]) {
      if (value === undefined) continue
      expect(value.startsWith('/')).toBe(false)
      expect(value).not.toMatch(/grannydb/)
    }
  })
})

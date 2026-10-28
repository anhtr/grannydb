// @vitest-environment jsdom
/**
 * One end-to-end render, against a small fixture dataset shaped like the real one.
 *
 * Not a component test suite — there is deliberately no per-component coverage. This exists because
 * typechecking cannot catch a crash at mount (a hook called conditionally, a value read before it
 * loads), and finding that out on a phone is a bad way to find out. It also exercises the whole
 * anonymous read path: fetch the bundle, build the schema set, replay an empty queue, render.
 *
 * Deliberately not `data/*.csv`: that is real, live tracker data that changes shape and content on
 * its own schedule (rows added, cleared, columns renamed), which has nothing to do with whether the
 * app still mounts. `fixtures/data/` is a frozen mirror of the schema shape this test can depend on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { StrictMode } from 'react'
import { buildBundle } from '../../../scripts/build-data'
import { App } from '../../app/App'

// Tells React that `act()` is available, so it batches effects instead of warning on every render.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { bundle } = buildBundle('src/core/__tests__/fixtures/data')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // The anonymous read path fetches the build-time bundle from the same origin.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('bundle.json')) {
        return new Response(JSON.stringify(bundle), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
  window.location.hash = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(hash: string) {
  window.location.hash = hash
  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  // Let the store's async init settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('App renders against the real data', () => {
  it('shows the squares list with data from the bundle', async () => {
    await render('#/squares')
    const text = container.textContent ?? ''

    expect(text).toContain('Squares')
    expect(text).toContain('FS1')
    expect(text).toContain('Fixture Granny') // resolved through the design_id reference
  })

  it('renders a square detail with references resolved', async () => {
    await render('#/squares/FS1')
    const text = container.textContent ?? ''

    expect(text).toContain('Fixture Granny') // design_id -> designs.name
    expect(text).toContain('Fixture Cream') // main_yarn -> yarns.name
    expect(text).toContain('Fixture Rose') // one of the extra_yarns, via the reflist renderer
  })

  it('titles a record page by name, keeps its id in view, and links back to the list', async () => {
    await render('#/yarns/FY2')
    const header = container.querySelector('header')
    expect(header?.querySelector('h1')?.textContent).toBe('Fixture Rose')
    expect(header?.textContent).toContain('Yarn · FY2')
    expect(header?.querySelector('a')?.getAttribute('href')).toBe('#/yarns')
    expect(document.title).toBe('Fixture Rose · grannydb')
  })

  it('hides editing controls without a token', async () => {
    await render('#/squares/FS1')
    const text = container.textContent ?? ''

    expect(text).toContain('Read-only')
    expect(text).not.toContain('Delete')
  })

  it('renders the progress screen without dividing by zero on empty tallies', async () => {
    await render('#/stats')
    const text = container.textContent ?? ''

    expect(text).toContain('Finished')
    expect(text).toContain('By colour')
    // The target comes from the fixture's project.json, via the bundle.
    expect(text).toMatch(/\d+ \/ 10/)
  })

  it('links the progress screen colours to their yarn pages', async () => {
    await render('#/stats')
    // Collapsed by default, so these are the colour chips rather than the expanded rows.
    expect(container.querySelector('a[href="#/yarns/FY1"]')).not.toBeNull()
    expect(container.querySelector('a[href="#/yarns/FY2"]')).not.toBeNull()
  })

  it('renders the yarns list from the generic components', async () => {
    await render('#/yarns')
    expect(container.textContent).toContain('Fixture Rose')
  })

  it('renders settings without a token saved', async () => {
    await render('#/settings')
    expect(container.textContent).toContain('Contents: read and write')
  })

  it('builds a nav tab per table in the manifest', async () => {
    await render('#/squares')
    const nav = container.querySelector('nav')
    const labels = [...(nav?.querySelectorAll('a') ?? [])].map((a) => a.textContent)
    expect(labels).toEqual(['Squares', 'Yarns', 'Designs', 'Progress', 'Settings'])
  })

  it('shows a not-found screen for an unknown route', async () => {
    await render('#/nope')
    expect(container.textContent).toContain('Not found')
  })
})

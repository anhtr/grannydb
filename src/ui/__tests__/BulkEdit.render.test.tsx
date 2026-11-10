// @vitest-environment jsdom
/**
 * The bulk-edit dialog, mounted against the fixture dataset: that the preview on screen is the plan
 * that gets queued, and that the dialog takes focus and gives way to Escape. The rules themselves
 * are pinned without a DOM in `core/__tests__/bulk.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { buildBundle } from '../../../scripts/build-data'
import type { BulkEditPlan } from '../../core/schema'
import { appStore } from '../../core/store'
import type { RowChange } from '../../core/store'
import { BulkEditDialog } from '../BulkEdit'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { bundle } = buildBundle('src/core/__tests__/fixtures/data')

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('bundle.json')) return new Response(JSON.stringify(bundle), { status: 200 })
      throw new Error(`unexpected fetch: ${String(input)}`)
    }),
  )
  await appStore.init()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** Type into a controlled input the way a browser would, so React's `onChange` sees it. */
function setValue(el: HTMLSelectElement | HTMLTextAreaElement | HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

function mount(onClose: () => void, onApplied: (plan: BulkEditPlan) => void) {
  const state = appStore.getState()
  const schema = state.snapshot!.schemas.tables.squares
  act(() => {
    root.render(
      <BulkEditDialog table="squares" schema={schema} rows={state.data.squares.rows} onClose={onClose} onApplied={onApplied} />,
    )
  })
}

describe('BulkEditDialog', () => {
  it('previews the change, then queues exactly that as one operation per row', async () => {
    const applied: BulkEditPlan[] = []
    mount(() => {}, (plan) => applied.push(plan))

    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(dialog.textContent).toContain('Choose a value')

    act(() => setValue(dialog.querySelector('select')!, 'notes'))
    act(() => setValue(dialog.querySelector('textarea')!, 'for the border'))
    expect(dialog.textContent).toMatch(/Changes notes on 2 /)

    const apply = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Change 2')!
    await act(async () => {
      apply.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(applied).toHaveLength(1)
    expect(applied[0].writes.map((w) => w.id)).toEqual(['FS1', 'FS2'])
    expect(appStore.row('squares', 'FS2')?.notes).toBe('for the border')
    // Field-level: each queued operation carries the id and the one field, not the row.
    expect(appStore.getState().changes.map((c) => (c as RowChange).values)).toEqual([
      { id: 'FS1', notes: 'for the border' },
      { id: 'FS2', notes: 'for the border' },
    ])
  })

  it('offers nothing to apply until a value is chosen, and closes on Escape', () => {
    let closed = 0
    mount(() => closed++, () => {})

    const dialog = container.querySelector('[role="dialog"]')!
    const apply = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Change')!
    expect(apply.disabled).toBe(true)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(closed).toBe(1)
  })
})

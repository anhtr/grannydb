// @vitest-environment jsdom
/**
 * The `ref` picker as a screen reader meets it: a combobox that owns a listbox, with the option the
 * arrow keys have reached named by `aria-activedescendant`. None of that is visible, so nothing but
 * a test notices when it breaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { buildBundle } from '../../../scripts/build-data'
import type { FieldDef } from '../../core/schema'
import { appStore } from '../../core/store'
import { rendererFor } from '../fields'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { bundle } = buildBundle('src/core/__tests__/fixtures/data')

let container: HTMLDivElement
let root: Root
let picked: string[]

function Harness({ field }: { field: FieldDef }) {
  const [value, setValue] = useState('')
  const { Input } = rendererFor(field)
  return (
    <Input
      field={field}
      value={value}
      id="pick"
      onChange={(next) => {
        picked.push(next)
        setValue(next)
      }}
    />
  )
}

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('bundle.json')) return new Response(JSON.stringify(bundle), { status: 200 })
      throw new Error(`unexpected fetch: ${String(input)}`)
    }),
  )
  // jsdom lays nothing out, so it has no scrolling to do; the picker asks for it on every arrow key.
  Element.prototype.scrollIntoView = vi.fn()
  await appStore.init()
  picked = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const field = appStore.getState().snapshot!.schemas.tables.squares.fields.find((f) => f.key === 'main_yarn')!
  act(() => root.render(<Harness field={field} />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function press(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('ref picker', () => {
  it('is a combobox whose listbox opens on focus, with the first option active', () => {
    const input = container.querySelector<HTMLInputElement>('#pick')!
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[role="listbox"]')).toBeNull()

    act(() => input.focus())
    const listbox = container.querySelector('[role="listbox"]')!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)

    const options = [...listbox.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent)).toEqual(['Fixture CreamSkeins left: 4', 'Fixture RoseSkeins left: 2'])
    // A listbox holds options and nothing a Tab could stop on.
    expect(listbox.querySelectorAll('button, a, input')).toHaveLength(0)
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(container.querySelector('[role="status"]')?.textContent).toBe('2 matches')
  })

  it('moves the active option with the arrow keys and picks it with Enter', () => {
    const input = container.querySelector<HTMLInputElement>('#pick')!
    act(() => input.focus())
    press(input, 'ArrowDown')

    const options = [...container.querySelectorAll('[role="option"]')]
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id)
    expect(options[1].getAttribute('aria-selected')).toBe('true')

    press(input, 'Enter')
    expect(picked).toEqual(['FY2'])
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(input.value).toBe('Fixture Rose')
  })

  it('picks an option that is clicked', () => {
    const input = container.querySelector<HTMLInputElement>('#pick')!
    act(() => input.focus())
    act(() => container.querySelector<HTMLElement>('[role="option"]')!.click())
    expect(picked).toEqual(['FY1'])
  })
})

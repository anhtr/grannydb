// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme } from '../../app/theme'

const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)

describe('applyTheme', () => {
  beforeEach(() => {
    // The two metas as `index.html` has them.
    document.head.innerHTML =
      '<meta name="theme-color" content="#1c1917" media="(prefers-color-scheme: dark)" />' +
      '<meta name="theme-color" content="#faf7f2" media="(prefers-color-scheme: light)" />'
    document.documentElement.removeAttribute('data-theme')
  })

  it('marks the root element with a choice, and both chrome colours follow it', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(metas()).toEqual(['#1c1917', '#1c1917'])
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(metas()).toEqual(['#faf7f2', '#faf7f2'])
  })

  it('hands the decision back to the system by removing the mark, not by guessing it', () => {
    applyTheme('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(metas()).toEqual(['#1c1917', '#faf7f2'])
  })

  it('does nothing harmful on a page with no chrome-colour metas', () => {
    document.head.innerHTML = ''
    expect(() => applyTheme('light')).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

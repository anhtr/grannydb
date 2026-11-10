import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { latestRelease } from '../../../scripts/app-version'

describe('latestRelease', () => {
  it('reads the version and date from the first entry heading', () => {
    const text = '# Changelog\n\nIntro.\n\n## 2026-11-10 - v0.1.61, settings\n\n- x\n\n## 2026-11-09 - v0.1.60, older\n'
    expect(latestRelease(text)).toEqual({ version: '0.1.61', date: '2026-11-10' })
  })

  it('reads a heading whichever dash it was written with', () => {
    expect(latestRelease('## 2026-08-17 — v0.1.0, first build\n')).toEqual({ version: '0.1.0', date: '2026-08-17' })
  })

  it('skips a heading that is not an entry, and says so when there is none', () => {
    expect(latestRelease('## Unreleased\n\n## 2026-09-01 - v0.1.7, x\n')).toEqual({ version: '0.1.7', date: '2026-09-01' })
    expect(latestRelease('# Changelog\n\nNothing yet.\n')).toBeNull()
  })

  // The build shows "unknown" rather than failing when this returns null, so nothing else would
  // notice a heading written in a shape the pattern does not read.
  it('reads the real changelog, whose newest entry is its first', () => {
    const text = readFileSync('docs/CHANGELOG.md', 'utf8')
    const release = latestRelease(text)
    expect(release).not.toBeNull()
    const first = /^## (.*)$/m.exec(text)?.[1] ?? ''
    expect(first).toContain(`${release?.date}`)
    expect(first).toContain(`v${release?.version}`)
  })
})

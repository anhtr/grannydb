import { describe, expect, it } from 'vitest'
import { applyProjectValues, parseProject, projectInfo, serializeProject, validateProject } from '../project'
import { applyProjectChanges } from '../store/merge'
import { projectChange } from '../store/queue'

describe('project.json', () => {
  it('reads start date, target and time zone, treating malformed values as unset', () => {
    expect(projectInfo({ start_date: '2026-07-03', target_squares: 400, time_zone: 'America/Chicago' })).toEqual({
      startDate: '2026-07-03',
      targetSquares: 400,
      timeZone: 'America/Chicago',
    })
    expect(projectInfo({ start_date: '3 July', target_squares: '400', time_zone: 'Central' })).toEqual({
      startDate: '',
      targetSquares: 0,
      timeZone: '',
    })
    expect(projectInfo({})).toEqual({ startDate: '', targetSquares: 0, timeZone: '' })
  })

  it('flags malformed values for the build-time data check', () => {
    expect(validateProject({ start_date: '2026-07-03', target_squares: 400, time_zone: 'Europe/London' })).toEqual([])
    expect(
      validateProject({ start_date: '07/03/2026', target_squares: 1.5, time_zone: 'Mars/Olympus' }).map((i) => i.field),
    ).toEqual(['start_date', 'target_squares', 'time_zone'])
  })

  it('rejects a file that is not a JSON object', () => {
    expect(() => parseProject('[]')).toThrow()
    expect(parseProject('{"target_squares": 400}')).toEqual({ target_squares: 400 })
  })

  it('sets keys, removes them for null, and keeps everything else', () => {
    const doc = { blanket_name: 'Garden', start_date: '2026-01-01' }
    expect(applyProjectValues(doc, { start_date: null, target_squares: 400 })).toEqual({
      blanket_name: 'Garden',
      target_squares: 400,
    })
  })

  it('replays queued edits in timestamp order', () => {
    const later = { ...projectChange({ target_squares: 500 }), ts: 2 }
    const earlier = { ...projectChange({ target_squares: 400, start_date: '2026-07-03' }), ts: 1 }
    expect(applyProjectChanges({}, [later, earlier])).toEqual({ target_squares: 500, start_date: '2026-07-03' })
  })

  it('serialises with two-space indent and a trailing newline', () => {
    expect(serializeProject({ target_squares: 400 })).toBe('{\n  "target_squares": 400\n}\n')
  })
})

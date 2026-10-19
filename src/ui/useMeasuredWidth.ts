import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * The rendered width of an element, kept current as the screen changes.
 *
 * Which labels fit above the Progress screen's status bar, and how many axis labels fit under a
 * chart, are things a stylesheet cannot decide and an estimate gets wrong in both directions: assume
 * a narrow screen and a 390px phone loses labels it had room for; assume a wide one and a 320px phone
 * clips them. So measure. Before the
 * first measurement — and under jsdom, which has no `ResizeObserver` — the caller falls back to the
 * narrowest-phone estimate, which is never *too* generous.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

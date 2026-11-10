import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

/**
 * The keyboard half of something that opens over the page - what `role="dialog"` promises and does
 * not itself provide. For as long as the element holding the returned ref is mounted:
 *
 * - focus **moves into it** when it opens, so a keyboard or screen reader user is put where the new
 *   controls are instead of being left on the button behind them - onto its first control, or with
 *   `focus: 'container'` onto the element itself (which then needs `tabIndex={-1}`). The second is
 *   for a panel whose first control may be a text box: focusing that on a phone throws the
 *   keyboard up over a panel the person only opened to look at;
 * - **Escape** closes it;
 * - focus **goes back** to whatever had it before, when it closes, so the next Tab carries on from
 *   where the person was rather than from the top of the page;
 * - with `modal`, Tab **wraps** inside it and the page behind stops scrolling - the page is covered,
 *   so focus wandering onto it would be focus on something that cannot be seen.
 *
 * Hand-rolled rather than the native `<dialog>` element so that it behaves the same in the test
 * environment (jsdom has no `showModal`) as in a browser, and so the non-modal panels can share it.
 */
export function useDialog<T extends HTMLElement>(
  onClose: () => void,
  options: { modal?: boolean; focus?: 'first' | 'container' } = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const modal = options.modal ?? false
  const focusFirst = options.focus !== 'container'
  // Kept in a ref so a caller passing a new closure every render does not re-run the effect below,
  // which would steal focus back to the first control on each keystroke.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;((focusFirst ? focusable(container)[0] : undefined) ?? container).focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A picker inside the dialog that used Escape to close its own results has prevented the
        // default; that press was for the picker, not for the dialog around it.
        if (e.defaultPrevented) return
        e.preventDefault()
        close.current()
        return
      }
      if (!modal || e.key !== 'Tab') return
      const items = focusable(container)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || !container.contains(at))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !container.contains(at))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    const previousOverflow = document.body.style.overflow
    if (modal) document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      if (modal) document.body.style.overflow = previousOverflow
      // Only if the opener is still on the page: a dialog whose action removed its own trigger has
      // nowhere to hand focus back to.
      if (opener?.isConnected) opener.focus()
    }
  }, [modal, focusFirst])

  return ref
}

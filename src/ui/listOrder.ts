import { compareIds } from '../core/csv'

/**
 * The order each list was last shown in, so a record page can offer the one before and the one
 * after - a **cursor** over a result the list has already worked out.
 *
 * Kept here, in memory, rather than worked out again on the record page: the order is the product of
 * the search text, the filters, the sort rules and whatever extra filters and sorts the table's own
 * page passes in, and only the list has all of those. See ADR 0039. It is gone on a reload, like the
 * search text and scroll position beside it (`listMemory` in `RecordList.tsx`); `recordOrder` then
 * falls back to plain id order.
 */
const orders = new Map<string, string[]>()

/** Called by `RecordList` whenever what it shows changes. */
export function rememberListOrder(table: string, ids: string[]): void {
  orders.set(table, ids)
}

/**
 * The order to step through `table` in: the list's last order, less anything deleted since, or every
 * record by id when the list has not been opened this session (a shared link, a reload).
 */
export function recordOrder(table: string, existingIds: string[]): string[] {
  const remembered = orders.get(table)
  if (!remembered) return [...existingIds].sort(compareIds)
  const existing = new Set(existingIds)
  return remembered.filter((id) => existing.has(id))
}

export interface Neighbours {
  /** 1-based, for "3 of 42". */
  position: number
  total: number
  previous: string | null
  next: string | null
}

/**
 * Where `id` sits in `order`, or null when it is not there at all - a record created since the list
 * was last shown, or one the list's filters hide. Null means "offer nothing": stepping from a record
 * that is not in the list into a list it was never part of would be a guess.
 */
export function neighbours(order: string[], id: string): Neighbours | null {
  const index = order.indexOf(id)
  if (index === -1) return null
  return {
    position: index + 1,
    total: order.length,
    previous: index > 0 ? order[index - 1] : null,
    next: index < order.length - 1 ? order[index + 1] : null,
  }
}

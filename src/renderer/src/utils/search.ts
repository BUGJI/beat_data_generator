/**
 * Binary-search helpers for sorted, index-paged lists (tempo/meter/grid
 * segments, sorted markers, flash-event lists). Keeping one implementation
 * means the boundary behaviour is identical everywhere.
 */

/** Index of the last item whose key is `<= target`, or -1 when none match. */
export function lastAtOrBefore<T>(
  items: readonly T[],
  key: (item: T) => number,
  target: number,
): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid] as T) <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Index of the first item whose key is `>= target`, or `items.length`. */
export function lowerBound<T>(
  items: readonly T[],
  key: (item: T) => number,
  target: number,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid] as T) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

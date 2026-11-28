export interface VirtualItem<T> {
  readonly index: number;
  readonly startPx: number;
  readonly sizePx: number;
  readonly item: T;
}

export interface VirtualWindow<T> {
  readonly totalHeightPx: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly items: readonly VirtualItem<T>[];
}

/** Fixed or per-row windowing. Only the viewport slice is returned. */
export class VirtualizedLaneColumn {
  window<T>(
    items: readonly T[],
    heightOf: (item: T) => number,
    scrollTop: number,
    viewportHeightPx: number,
    overscanPx: number,
  ): VirtualWindow<T> {
    const starts = new Array<number>(items.length);
    const heights = new Array<number>(items.length);
    let total = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      const height = heightOf(item);
      starts[index] = total;
      heights[index] = height;
      total += height;
    }
    const viewStart = Math.max(0, scrollTop - overscanPx);
    const viewEnd = scrollTop + Math.max(0, viewportHeightPx) + overscanPx;
    let startIndex = 0;
    while (startIndex < items.length) {
      const start = starts[startIndex] ?? 0;
      const height = heights[startIndex] ?? 0;
      if (start + height > viewStart) break;
      startIndex += 1;
    }
    let endIndex = startIndex;
    while (endIndex < items.length) {
      const start = starts[endIndex] ?? 0;
      if (start >= viewEnd) break;
      endIndex += 1;
    }
    const visible: VirtualItem<T>[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      visible.push({
        index,
        startPx: starts[index] ?? 0,
        sizePx: heights[index] ?? 0,
        item,
      });
    }
    return { totalHeightPx: total, startIndex, endIndex, items: visible };
  }
}

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

interface UseVirtualListOptions {
  /** Scroll container that owns the scrollbar. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Element inside the scroll container where the virtual rows begin. */
  listRef: RefObject<HTMLElement | null>;
  keys: string[];
  /** Height assumed for rows that have not been measured yet. */
  estimateSize: number;
  /** Extra pixels rendered above and below the viewport. */
  overscan: number;
}

export interface VirtualRowItem {
  index: number;
  key: string;
  top: number;
}

/** Largest row index whose top edge is at or above `y`. */
function findRow(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Windowing for a list of variable-height rows. Only rows intersecting the
 * viewport (plus overscan) should be rendered by the caller, each wrapped in
 * a `VirtualRow` so its real height is measured and fed back here.
 */
export function useVirtualList({ scrollRef, listRef, keys, estimateSize, overscan }: UseVirtualListOptions) {
  const [listTop, setListTop] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());

  const syncViewport = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const list = listRef.current;
    const scrollerTop = scroller.getBoundingClientRect().top;
    setListTop(list ? list.getBoundingClientRect().top - scrollerTop + scroller.scrollTop : 0);
    setScrollTop(scroller.scrollTop);
    setViewportHeight(scroller.clientHeight);
  }, [scrollRef, listRef]);

  // Content above the list (e.g. error banners) can change its offset, so re-sync after every commit.
  useLayoutEffect(() => {
    syncViewport();
  });

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.addEventListener('scroll', syncViewport, { passive: true });
    const observer = new ResizeObserver(syncViewport);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', syncViewport);
      observer.disconnect();
    };
  }, [scrollRef, syncViewport]);

  const measureRow = useCallback((key: string, height: number) => {
    setHeights((prev) => (prev.get(key) === height ? prev : new Map(prev).set(key, height)));
  }, []);

  const { offsets, totalHeight } = useMemo(() => {
    const offsets = new Array<number>(keys.length + 1);
    let total = 0;
    keys.forEach((key, i) => {
      offsets[i] = total;
      total += heights.get(key) ?? estimateSize;
    });
    offsets[keys.length] = total;
    return { offsets, totalHeight: total };
  }, [keys, estimateSize, heights]);

  const first = findRow(offsets, Math.max(0, scrollTop - listTop - overscan));
  const last = keys.length === 0 ? -1 : findRow(offsets, scrollTop - listTop + viewportHeight + overscan);

  const rows: VirtualRowItem[] = [];
  for (let i = first; i <= last; i++) {
    rows.push({ index: i, key: keys[i], top: offsets[i] });
  }

  return { rows, totalHeight, lastVisibleIndex: last, measureRow };
}

interface VirtualRowProps {
  rowKey: string;
  top: number;
  measure: (key: string, height: number) => void;
  children: ReactNode;
}

/** Absolutely positioned row that reports its rendered height. The bottom padding is the inter-row gap. */
export function VirtualRow({ rowKey, top, measure, children }: VirtualRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => measure(rowKey, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowKey, measure]);

  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, right: 0, top, paddingBottom: 8 }}>
      {children}
    </div>
  );
}

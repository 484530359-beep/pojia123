import { useCallback } from "react";

/**
 * Returns an onWheel handler that allows scroll events to pass through
 * to the parent when the inner container has reached its top or bottom edge.
 * Use this on nested scrollable elements to enable natural scroll chaining.
 */
export function useScrollPassthrough() {
  return useCallback((e: React.WheelEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    const scrollingUp = e.deltaY < 0;
    const scrollingDown = e.deltaY > 0;

    // If at the edge and scrolling further in that direction, let event propagate
    if ((atTop && scrollingUp) || (atBottom && scrollingDown)) {
      return; // don't stop propagation — parent will scroll
    }
    // Otherwise, contain the scroll within this element
    e.stopPropagation();
  }, []);
}

"use client";

import { useEffect, useRef, useState } from "react";
import { PullToRefreshGesture } from "./pull-to-refresh-gesture";

export function usePullToRefresh(onRefresh: () => Promise<void>, enabled: boolean) {
  const pageRef = useRef<HTMLElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let active = true;
    let busy = false;
    const gesture = new PullToRefreshGesture();
    queueMicrotask(() => {
      if (!active) return;
      setPullDistance(0);
      setIsRefreshing(false);
    });
    if (!enabled) return () => { active = false; };

    // Suppress the browser's own pull-to-reload only on this screen.
    document.documentElement.classList.add("climbs-pull-to-refresh");
    function start(event: TouchEvent) {
      if (busy || !(event.target instanceof Element)) return;
      gesture.cancel();
      setPullDistance(0);
      if (event.target.closest("input, textarea, select, button, [contenteditable]")) return;
      const touch = event.touches[0];
      if (!touch) return;
      gesture.start(touch.clientX, touch.clientY, event.touches.length,
        document.scrollingElement?.scrollTop ?? window.scrollY, window.visualViewport?.scale ?? 1);
    }
    function move(event: TouchEvent) {
      if (busy) return;
      const touch = event.touches[0];
      if (!touch) return;
      const distance = gesture.move(touch.clientX, touch.clientY, event.touches.length);
      if (distance > 0) {
        if (!event.cancelable) {
          gesture.cancel();
          setPullDistance(0);
          return;
        }
        event.preventDefault();
      }
      setPullDistance(distance);
    }
    async function end(event: TouchEvent) {
      if (busy) return;
      if (event.touches.length > 0) {
        cancel();
        return;
      }
      if (gesture.distance > 0 && event.cancelable) event.preventDefault();
      const shouldRefresh = gesture.release();
      setPullDistance(0);
      if (!shouldRefresh) return;
      busy = true;
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        busy = false;
        if (active) setIsRefreshing(false);
      }
    }
    function cancel() {
      gesture.cancel();
      setPullDistance(0);
    }
    page.addEventListener("touchstart", start, { passive: true });
    page.addEventListener("touchmove", move, { passive: false });
    page.addEventListener("touchend", end, { passive: false });
    page.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      active = false;
      document.documentElement.classList.remove("climbs-pull-to-refresh");
      page.removeEventListener("touchstart", start);
      page.removeEventListener("touchmove", move);
      page.removeEventListener("touchend", end);
      page.removeEventListener("touchcancel", cancel);
    };
  }, [enabled, onRefresh]);

  return { pageRef, pullDistance, isRefreshing };
}

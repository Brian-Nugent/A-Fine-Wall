const MIN_SWIPE_DISTANCE = 64;
const MAX_SWIPE_DISTANCE = 112;
const SWIPE_VIEWPORT_RATIO = 0.18;
const HORIZONTAL_DOMINANCE = 1.75;
const MAX_VERTICAL_DISTANCE = 48;
const MAX_SWIPE_DURATION_MS = 700;
const BROWSER_EDGE_GUARD = 32;
const INTENT_DISTANCE = 12;

export type SwipePoint = {
  x: number;
  y: number;
  time: number;
};

export type HorizontalSwipeDirection = "previous" | "next";
export type SwipeIntent = "pending" | "horizontal" | "vertical";

export function updateSwipeIntent(
  current: SwipeIntent,
  start: SwipePoint,
  latest: SwipePoint,
): SwipeIntent {
  if (current !== "pending") return current;

  const horizontalDistance = Math.abs(latest.x - start.x);
  const verticalDistance = Math.abs(latest.y - start.y);
  if (
    horizontalDistance < INTENT_DISTANCE &&
    verticalDistance < INTENT_DISTANCE
  ) {
    return "pending";
  }

  return horizontalDistance > verticalDistance ? "horizontal" : "vertical";
}

export function horizontalSwipeDirection(
  start: SwipePoint,
  end: SwipePoint,
  viewportWidth: number,
): HorizontalSwipeDirection | null {
  if (
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= BROWSER_EDGE_GUARD * 2 ||
    start.x <= BROWSER_EDGE_GUARD ||
    start.x >= viewportWidth - BROWSER_EDGE_GUARD
  ) {
    return null;
  }

  const duration = end.time - start.time;
  if (duration < 0 || duration > MAX_SWIPE_DURATION_MS) return null;

  const horizontalDistance = end.x - start.x;
  const verticalDistance = end.y - start.y;
  const requiredDistance = Math.min(
    MAX_SWIPE_DISTANCE,
    Math.max(MIN_SWIPE_DISTANCE, viewportWidth * SWIPE_VIEWPORT_RATIO),
  );
  if (
    Math.abs(horizontalDistance) < requiredDistance ||
    Math.abs(verticalDistance) > MAX_VERTICAL_DISTANCE ||
    Math.abs(horizontalDistance) <
      Math.abs(verticalDistance) * HORIZONTAL_DOMINANCE
  ) {
    return null;
  }

  return horizontalDistance < 0 ? "next" : "previous";
}

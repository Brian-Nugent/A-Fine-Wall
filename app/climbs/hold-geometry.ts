/** Coordinates are percentages of the original photo, independent of screen size. */
export type HoldPoint = { x: number; y: number };
export type HoldGeometry = HoldPoint & { size: number; outline?: HoldPoint[] };
export const MAX_OUTLINE_POINTS = 96;

export function outlineArea(points: readonly HoldPoint[]) {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function isHoldOutline(value: unknown): value is HoldPoint[] {
  return Array.isArray(value) && value.length >= 3 &&
    value.length <= MAX_OUTLINE_POINTS && value.every(point =>
      point && typeof point === "object" &&
      Object.keys(point).every(key => key === "x" || key === "y") &&
      typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x <= 100 &&
      typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y <= 100,
    ) && outlineArea(value) > 0.0001;
}

const round = (value: number) => Number(value.toFixed(3));

export function outlineBounds(points: readonly HoldPoint[]) {
  return {
    left: Math.min(...points.map(point => point.x)),
    right: Math.max(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}

/** Restrict dragging to the actual hold rather than covering its neighbors. */
export function outlineHitStyle(points: readonly HoldPoint[]) {
  const bounds = outlineBounds(points);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return {
    left: `${bounds.left}%`, top: `${bounds.top}%`,
    width: `${width}%`, height: `${height}%`,
    aspectRatio: "auto", transform: "none",
    clipPath: `polygon(${points.map(point => `${(point.x - bounds.left) / width * 100}% ${(point.y - bounds.top) / height * 100}%`).join(",")})`,
  };
}

export function withHoldOutline<T extends HoldGeometry>(hold: T, points: readonly HoldPoint[]): T {
  const outline = points.map(point => ({ x: round(point.x), y: round(point.y) }));
  const bounds = outlineBounds(outline);
  return {
    ...hold,
    x: round((bounds.left + bounds.right) / 2),
    y: round((bounds.top + bounds.bottom) / 2),
    size: round(Math.max(0.01, Math.min(20, bounds.right - bounds.left))),
    outline,
  };
}

export function moveHoldTo<T extends HoldGeometry>(hold: T, x: number, y: number): T {
  if (!hold.outline) {
    const clamp = (value: number) => round(Math.max(hold.size / 2, Math.min(100 - hold.size / 2, value)));
    return { ...hold, x: clamp(x), y: clamp(y) };
  }
  const bounds = outlineBounds(hold.outline);
  const dx = Math.max(-bounds.left, Math.min(100 - bounds.right, x - hold.x));
  const dy = Math.max(-bounds.top, Math.min(100 - bounds.bottom, y - hold.y));
  return withHoldOutline(hold, hold.outline.map(point => ({ x: point.x + dx, y: point.y + dy })));
}

export function resizeHoldTo<T extends HoldGeometry>(hold: T, size: number): T {
  if (!hold.outline) return moveHoldTo({ ...hold, size }, hold.x, hold.y);
  const bounds = outlineBounds(hold.outline);
  const scale = Math.min(size / hold.size,
    hold.x / Math.max(0.001, hold.x - bounds.left),
    (100 - hold.x) / Math.max(0.001, bounds.right - hold.x),
    hold.y / Math.max(0.001, hold.y - bounds.top),
    (100 - hold.y) / Math.max(0.001, bounds.bottom - hold.y));
  return withHoldOutline(hold, hold.outline.map(point => ({
    x: hold.x + (point.x - hold.x) * scale,
    y: hold.y + (point.y - hold.y) * scale,
  })));
}

export function pointInOutline(point: HoldPoint, outline: readonly HoldPoint[]) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Prefer the touched boundary over a nearby hold's center on crowded walls. */
export function findHoldAtPoint<T extends HoldGeometry>(
  holds: readonly T[], x: number, y: number, width: number, height: number,
): T | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const point = { x: x / width * 100, y: y / height * 100 };
  const containing = holds.filter(hold => hold.outline && pointInOutline(point, hold.outline))
    .sort((a, b) => outlineArea(a.outline!) - outlineArea(b.outline!));
  if (containing.length > 0) return containing[0];
  let best: { hold: T; distance: number } | undefined;
  for (const hold of holds) {
    let distance = Infinity;
    if (hold.outline) {
      for (let i = 0; i < hold.outline.length; i++) {
        const a = hold.outline[i];
        const b = hold.outline[(i + 1) % hold.outline.length];
        const ax = a.x / 100 * width, ay = a.y / 100 * height;
        const dx = (b.x - a.x) / 100 * width, dy = (b.y - a.y) / 100 * height;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
    } else {
      distance = Math.max(0, Math.hypot(x - hold.x / 100 * width, y - hold.y / 100 * height) - hold.size / 200 * width);
    }
    if (distance <= 12 && (!best || distance < best.distance)) best = { hold, distance };
  }
  return best?.hold;
}

export const PULL_REFRESH_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 80;
const DIRECTION_THRESHOLD = 8;

export class PullToRefreshGesture {
  distance = 0;
  private startPoint: { x: number; y: number } | null = null;
  private pulling = false;

  start(x: number, y: number, touchCount: number, scrollTop: number, scale: number) {
    this.cancel();
    if (touchCount === 1 && scrollTop <= 0 && scale === 1) this.startPoint = { x, y };
  }

  move(x: number, y: number, touchCount: number) {
    if (!this.startPoint) return this.distance;
    if (touchCount !== 1) return this.cancel();
    const dx = Math.abs(x - this.startPoint.x);
    const dy = y - this.startPoint.y;
    if (!this.pulling) {
      if (Math.max(dx, Math.abs(dy)) < DIRECTION_THRESHOLD) return 0;
      if (dy <= dx) return this.cancel();
      this.pulling = true;
    }
    this.distance = Math.min(MAX_PULL_DISTANCE, Math.max(0, dy / 2));
    return this.distance;
  }

  release() {
    const shouldRefresh = this.distance >= PULL_REFRESH_THRESHOLD;
    this.cancel();
    return shouldRefresh;
  }

  cancel() {
    this.startPoint = null;
    this.pulling = false;
    this.distance = 0;
    return 0;
  }
}

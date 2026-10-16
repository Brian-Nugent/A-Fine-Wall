import assert from "node:assert/strict";
import test from "node:test";
import { PullToRefreshGesture } from "../app/climbs/pull-to-refresh-gesture.ts";

test("refresh requires releasing a long downward pull from the top", () => {
  const gesture = new PullToRefreshGesture();
  gesture.start(100, 100, 1, 0, 1);
  assert.equal(gesture.move(100, 105, 1), 0, "Small movements count as taps");
  assert.equal(gesture.move(100, 200, 1), 50);
  assert.equal(gesture.release(), false, "Short pulls do not refresh");
  gesture.start(100, 100, 1, 0, 1);
  assert.equal(gesture.move(100, 228, 1), 64);
  assert.equal(gesture.release(), true);
  assert.equal(gesture.release(), false, "One gesture triggers only one refresh");
  assert.equal(gesture.distance, 0);
});

test("scrolling, horizontal swipes, and pinch zoom do not refresh", () => {
  for (const [touches, scrollTop, scale] of [[1, 30, 1], [2, 0, 1], [1, 0, 2]]) {
    const gesture = new PullToRefreshGesture();
    gesture.start(100, 100, touches, scrollTop, scale);
    assert.equal(gesture.move(100, 300, 1), 0);
    assert.equal(gesture.release(), false);
  }
  for (const [x, y] of [[250, 110], [100, 50]]) {
    const gesture = new PullToRefreshGesture();
    gesture.start(100, 100, 1, 0, 1);
    assert.equal(gesture.move(x, y, 1), 0);
    assert.equal(gesture.move(100, 300, 1), 0, "Direction stays cancelled");
    assert.equal(gesture.release(), false);
  }
});

test("reversing, cancelling, or adding a finger cancels an armed refresh", () => {
  for (const cancel of [gesture => gesture.move(100, 110, 1), gesture => gesture.cancel(), gesture => gesture.move(100, 300, 2)]) {
    const gesture = new PullToRefreshGesture();
    gesture.start(100, 100, 1, 0, 1);
    assert.equal(gesture.move(100, 1000, 1), 80, "Long pulls are capped");
    cancel(gesture);
    assert.equal(gesture.release(), false);
    gesture.start(100, 100, 1, 0, 1);
    gesture.move(100, 300, 1);
    assert.equal(gesture.release(), true, "Next gesture can retry");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { circuitNumberSizeScale } from "../app/climbs/circuit-number-zoom.ts";

test("pinch zoom makes circuit numbers smaller on screen without becoming illegible", () => {
  const screenSizes = [1, 1.5, 2, 4, 8].map(zoom => circuitNumberSizeScale(zoom) * zoom);
  assert.equal(screenSizes[0], 1);
  assert.ok(screenSizes[1] < screenSizes[0]);
  assert.ok(screenSizes[2] < screenSizes[1]);
  assert.deepEqual(screenSizes.slice(2), [0.75, 0.75, 0.75]);
});

test("zooming back out restores the original circuit number size", () => {
  for (const zoom of [1, 0.5, 0, -1, NaN, Infinity]) {
    assert.equal(circuitNumberSizeScale(zoom), 1);
  }
});

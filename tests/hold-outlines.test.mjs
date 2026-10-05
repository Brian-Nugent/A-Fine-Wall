import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HoldOutlines, { holdOutlineStrokeWidth } from "../app/climbs/hold-outlines.tsx";
import WallPhoto from "../app/climbs/wall-photo.tsx";
import {
  findHoldAtPoint, isHoldOutline, moveHoldTo, outlineBounds, outlineHitStyle,
  pointInOutline, resizeHoldTo, withHoldOutline,
} from "../app/climbs/hold-geometry.ts";
import { loadWallHoldMap, resolveSavedHold, saveWallHolds } from "../app/climbs/wall-holds.ts";

const outline = [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 15, y: 30 }];
const hold = withHoldOutline({ id: "triangle", x: 0, y: 0, size: 1 }, outline);

test("validates bounded outlines and rejects malformed or collapsed boundaries", () => {
  assert.equal(isHoldOutline(outline), true);
  for (const invalid of [null, [], outline.slice(0, 2), [...outline, { x: NaN, y: 2 }],
    [{ x: -1, y: 20 }, ...outline], [{ x: 101, y: 20 }, ...outline],
    Array(97).fill(outline[0]), [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }],
    [{ ...outline[0], script: "bad" }, ...outline.slice(1)]]) {
    assert.equal(isHoldOutline(invalid), false);
  }
});

test("moves and resizes the entire boundary while keeping it on the photo", () => {
  const moved = moveHoldTo(hold, 25, 35);
  assert.deepEqual(moved.outline, outline.map(point => ({ x: point.x + 10, y: point.y + 10 })));
  assert.deepEqual(outlineBounds(moveHoldTo(hold, -10, -10).outline), { left: 0, right: 10, top: 0, bottom: 10 });
  const resized = resizeHoldTo(hold, 20);
  assert.deepEqual(outlineBounds(resized.outline), { left: 5, right: 25, top: 15, bottom: 35 });
  const atEdge = moveHoldTo(hold, 0, 0);
  assert.equal(isHoldOutline(resizeHoldTo(atEdge, 20).outline), true);
});

test("taps follow the boundary on landscape and portrait photos, including nested holds", () => {
  const long = withHoldOutline({ id: "long", x: 0, y: 0, size: 1 }, [
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 15 }, { x: 10, y: 15 },
  ]);
  const nearby = withHoldOutline({ id: "nearby", x: 0, y: 0, size: 1 }, [
    { x: 38, y: 17 }, { x: 41, y: 17 }, { x: 41, y: 20 },
  ]);
  assert.equal(findHoldAtPoint([nearby, long], 390, 120, 1000, 1000)?.id, "long");
  assert.equal(findHoldAtPoint([nearby, long], 390, 60, 1000, 500)?.id, "long");
  assert.equal(findHoldAtPoint([nearby, long], 195, 120, 500, 1000)?.id, "long");
  assert.equal(findHoldAtPoint([hold], 500, 500, 1000, 1000), undefined);
  assert.equal(findHoldAtPoint([hold], 500, 500, 0, 1000), undefined);
  assert.equal(pointInOutline({ x: 15, y: 22 }, outline), true);
  assert.equal(pointInOutline({ x: 11, y: 29 }, outline), false);
  const small = withHoldOutline({ id: "small", x: 0, y: 0, size: 1 }, [{ x: 14, y: 21 }, { x: 16, y: 21 }, { x: 15, y: 24 }]);
  assert.equal(findHoldAtPoint([hold, small], 150, 220, 1000, 1000)?.id, "small");
  assert.match(outlineHitStyle(outline).clipPath, /^polygon\(/);
});

test("shows the saved polygons in the correct role colors without adding circles", () => {
  const html = renderToStaticMarkup(createElement(HoldOutlines, { holds: [
    { ...hold, role: "start" }, { ...hold, id: "other", role: "available" },
    { id: "legacy", x: 20, y: 30, size: 7, role: "finish" },
  ] }));
  assert.match(html, /viewBox="0 0 100 100"/);
  assert.match(html, /preserveAspectRatio="none"/);
  assert.match(html, /hold-outline--start/);
  assert.match(html, /points="10,20 20,20 15,30"/);
  assert.match(html, /vector-effect="non-scaling-stroke"/);
  assert.equal((html.match(/<polygon/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<circle|<ellipse/);
});

test("keeps small hold outlines thin and increases thickness linearly to twice that width", () => {
  for (const [size, expected] of [[0.5, 0.75], [2, 0.75], [3.5, 0.9375], [5, 1.125], [8, 1.5], [20, 1.5]]) {
    assert.equal(holdOutlineStrokeWidth(size), expected);
    const html = renderToStaticMarkup(createElement(HoldOutlines, {
      holds: [{ ...hold, size, role: "hand" }],
    }));
    assert.match(html, new RegExp(`--hold-outline-width:${expected}px`));
    assert.match(html, /vector-effect="non-scaling-stroke"/);
  }
});

test("restores the original photo only inside selected hold boundaries", () => {
  const html = renderToStaticMarkup(createElement(WallPhoto, {
    alt: "Wall", className: "wall-photo", highlightedHolds: [hold],
  }));
  const clipId = html.match(/<clipPath id="([^"]+)"/)?.[1];
  assert.ok(clipId);
  assert.ok(html.includes(`clip-path="url(#${clipId})"`));
  assert.match(html, /class="wall-hold-highlights"/);
  assert.match(html, /clipPathUnits="userSpaceOnUse"/);
  assert.match(html, /points="10,20 20,20 15,30"/);
  assert.match(html, /<image href="\/api\/wall-photo" x="0" y="0" width="100" height="100" preserveAspectRatio="none"/);
  assert.match(html, /<svg aria-hidden="true" focusable="false"/);
  const plain = renderToStaticMarkup(createElement(WallPhoto, { alt: "Wall" }));
  assert.doesNotMatch(plain, /wall-hold-highlights|<clipPath/);
});

test("each wall photo has its own clipping region", () => {
  const html = renderToStaticMarkup(createElement("div", {},
    createElement(WallPhoto, { alt: "First wall", highlightedHolds: [hold] }),
    createElement(WallPhoto, { alt: "Second wall", highlightedHolds: [hold] }),
  ));
  const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("client wall save/load and climb resolution preserve the outline", async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "PUT") payload = JSON.parse(options.body);
    return Response.json({ holds: [hold], updatedAt: 12 });
  };
  try {
    assert.deepEqual((await saveWallHolds([hold], 11, "admin")).holds[0].outline, outline);
    assert.deepEqual(payload.holds[0].outline, outline);
    assert.deepEqual((await loadWallHoldMap()).holds[0].outline, outline);
    const saved = { holdId: hold.id, x: 50, y: 50, size: 2, role: "start" };
    assert.deepEqual(resolveSavedHold(saved, [hold]).outline, outline);
    const legacy = { id: hold.id, x: 10, y: 20, size: 7 };
    assert.equal("outline" in resolveSavedHold({ ...saved, outline }, [legacy]), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("the traced test-wall map has unique IDs and a valid boundary on every hold", async () => {
  const layout = JSON.parse(await readFile(new URL("../data/wall-layouts/2026-10-test-wall.json", import.meta.url), "utf8"));
  assert.equal(layout.holds.length, 432);
  assert.equal(new Set(layout.holds.map(hold => hold.id)).size, layout.holds.length);
  assert.match(layout.photoSha256, /^[a-f0-9]{64}$/);
  for (const hold of layout.holds) {
    assert.equal(isHoldOutline(hold.outline), true, hold.id);
    assert.ok(hold.size > 0 && hold.size <= 20, hold.id);
  }
});

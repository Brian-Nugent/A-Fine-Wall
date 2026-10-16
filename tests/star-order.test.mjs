import assert from "node:assert/strict";
import test from "node:test";
import {
  activeClimbFilterCount, adjacentClimbIds, buildFilteredHref, hasClimbFilterConstraints,
  parseClimbFilters, requiresClimbActivity, selectVisibleClimbs, serializeClimbFilters,
} from "../app/climbs/climb-filters.ts";

const filters = query => parseClimbFilters(new URLSearchParams(query));
const common = { grade: "V3", setter: "Alex", holds: [{ holdId: "hold-a" }] };
const activity = (averageRating, ratingCount = 1, userRating = null) => ({ averageRating, ratingCount, userRating });
const climbs = [
  { ...common, id: "unrated-new", createdAt: 70, activity: null },
  { ...common, id: "low", createdAt: 60, activity: activity(1, 20, 5) },
  { ...common, id: "four-b", createdAt: 40, activity: activity(4, 10) },
  { ...common, id: "four-old", createdAt: 30, activity: activity(4, 30) },
  { ...common, id: "highest", createdAt: 10, activity: activity(5, 1) },
  { ...common, id: "fractional", createdAt: 20, activity: activity(4.5, 2, 4) },
  { ...common, id: "four-a", createdAt: 40, activity: activity(4, 1) },
  { ...common, id: "unrated-old", createdAt: 50, activity: null },
];

test("star ordering round-trips in links and requires activity without limiting climbs", () => {
  const selected = filters("order=stars");
  assert.equal(selected.order, "stars");
  assert.equal(parseClimbFilters({ order: "stars" }).order, "stars");
  assert.equal(serializeClimbFilters(selected), "order=stars");
  assert.equal(activeClimbFilterCount(selected), 1);
  assert.equal(hasClimbFilterConstraints(selected), false);
  assert.equal(requiresClimbActivity(selected), true);
  const combined = filters("author=Alex&hold=hold-a&sent=hide&stars=4&circuits=only&order=stars");
  assert.deepEqual(filters(serializeClimbFilters(combined)), combined);
  assert.equal(buildFilteredHref("/climbs/saved", combined, { id: "highest" }),
    "/climbs/saved?author=Alex&hold=hold-a&sent=hide&stars=4&circuits=only&order=stars&id=highest");
});

test("star ordering uses average rating, then newest, then ID, with unrated climbs last", () => {
  const original = [...climbs];
  assert.deepEqual(selectVisibleClimbs(climbs, filters("order=stars")).map(climb => climb.id), [
    "highest", "fractional", "four-a", "four-b", "four-old", "low", "unrated-new", "unrated-old",
  ]);
  assert.deepEqual(climbs, original);
});

test("star ordering combines with rating and sent filters and preserves adjacent navigation", () => {
  const selected = filters("stars=4&sent=hide&order=stars");
  assert.deepEqual(selectVisibleClimbs(climbs, selected).map(climb => climb.id), [
    "highest", "four-a", "four-b", "four-old",
  ]);
  assert.deepEqual(adjacentClimbIds(climbs, "four-a", selected), {
    previousId: "highest", nextId: "four-b",
  });
  assert.deepEqual(adjacentClimbIds(climbs, "four-old", selected), {
    previousId: "four-b", nextId: null,
  });
});

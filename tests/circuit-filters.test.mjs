import assert from "node:assert/strict";
import test from "node:test";
import {
  activeClimbFilterCount, adjacentClimbIds, buildFilteredHref, hasClimbFilterConstraints,
  parseClimbFilters, requiresClimbActivity, selectVisibleClimbs, serializeClimbFilters,
} from "../app/climbs/climb-filters.ts";

const filters = query => parseClimbFilters(new URLSearchParams(query));
const common = {
  grade: "V2", setter: "Alex", holds: [{ holdId: "hold-a" }], rockoApproved: true,
  activity: { averageRating: 4, ratingCount: 1, userRating: null },
};
const climbs = [
  { ...common, id: "first-circuit", createdAt: 10, isCircuit: true },
  { ...common, id: "second-circuit", createdAt: 20, isCircuit: true, grade: "V6", activity: null, rockoApproved: false },
  { ...common, id: "ordinary", createdAt: 30, isCircuit: false },
  { ...common, id: "legacy", createdAt: 35 },
  { ...common, id: "sam-circuit", createdAt: 40, isCircuit: true, grade: "V6", setter: "Sam", holds: [{ holdId: "hold-b" }] },
];

test("circuits-only selection round-trips with other filters and counts as a constraint", () => {
  const selected = filters("list=favorites&color=gray&author=Alex&hold=hold-a&sent=hide&outdated=show&stars=4&rocko=approved&circuits=only&order=ascents");
  const query = serializeClimbFilters(selected);
  assert.equal(query, "list=favorites&color=gray&author=Alex&hold=hold-a&sent=hide&outdated=show&stars=4&rocko=approved&circuits=only&order=ascents");
  assert.deepEqual(filters(query), selected);
  assert.equal(parseClimbFilters({ circuits: "only" }).circuitsOnly, true);
  assert.equal(filters("circuits=invalid").circuitsOnly, false);
  assert.equal(activeClimbFilterCount(filters("circuits=only")), 1);
  assert.equal(hasClimbFilterConstraints(filters("circuits=only")), true);
  assert.equal(requiresClimbActivity(filters("circuits=only")), false);
  assert.equal(buildFilteredHref("/climbs/saved", filters("circuits=only"), { id: "first-circuit" }), "/climbs/saved?circuits=only&id=first-circuit");
  assert.equal(serializeClimbFilters(filters("")), "");
});

test("circuits-only filtering excludes ordinary and legacy climbs and limits adjacent navigation", () => {
  const selected = filters("circuits=only");
  assert.deepEqual(selectVisibleClimbs(climbs, selected).map(climb => climb.id), ["sam-circuit", "second-circuit", "first-circuit"]);
  assert.deepEqual(adjacentClimbIds(climbs, "second-circuit", selected), { previousId: "sam-circuit", nextId: "first-circuit" });
  assert.equal(selectVisibleClimbs(climbs, filters("")).length, climbs.length);
});

test("circuits-only combines with difficulty, zero ascents, Rocko approval, setter, and hold filters", () => {
  assert.deepEqual(selectVisibleClimbs(climbs, filters("circuits=only&color=gray")).map(climb => climb.id), ["second-circuit"]);
  assert.deepEqual(selectVisibleClimbs(climbs, filters("circuits=only&color=green")).map(climb => climb.id), ["first-circuit"]);
  assert.deepEqual(selectVisibleClimbs(climbs, filters("circuits=only&rocko=approved&author=Alex&hold=hold-a")).map(climb => climb.id), ["first-circuit"]);
  assert.deepEqual(selectVisibleClimbs(climbs, filters("circuits=only&stars=5")), []);
});

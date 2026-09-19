import assert from "node:assert/strict";
import test from "node:test";
import {
  activeClimbFilterCount,
  buildFilteredHref,
  compareClimbsByOrder,
  filterClimbs,
  hasClimbFilterConstraints,
  parseClimbFilters,
  serializeClimbFilters,
} from "../app/climbs/climb-filters.ts";

const boundaryClimbs = ["V0", "V4", "V5", "V7", "V8", "V17"].map(
  (grade) => ({ grade, setter: "Alex", holds: [] }),
);

function filtersFor(query = "") {
  return parseClimbFilters(new URLSearchParams(query));
}

function matchingGrades(query) {
  return filterClimbs(boundaryClimbs, filtersFor(query)).map(
    (climb) => climb.grade,
  );
}

test("color filters include the exact boundaries of each difficulty band", () => {
  assert.deepEqual(matchingGrades("color=green"), ["V0", "V4"]);
  assert.deepEqual(matchingGrades("color=yellow"), ["V5", "V7"]);
  assert.deepEqual(matchingGrades("color=red"), ["V8", "V17"]);
});

test("multiple color selections can exclude the middle difficulty band", () => {
  const filters = filtersFor("color=red&color=green&color=red");
  assert.deepEqual(filters.colors, ["green", "red"]);
  assert.deepEqual(
    filterClimbs(boundaryClimbs, filters).map((climb) => climb.grade),
    ["V0", "V4", "V8", "V17"],
  );
  assert.equal(serializeClimbFilters(filters), "color=green&color=red");
  assert.equal(activeClimbFilterCount(filters), 1);
});

test("legacy exact grade links expand to a full color band", () => {
  for (const [grade, expected] of [
    [0, "green"], [4, "green"], [5, "yellow"],
    [6, "yellow"], [7, "yellow"], [8, "red"], [17, "red"],
  ]) {
    const filters = filtersFor(`min=${grade}&max=${grade}`);
    assert.deepEqual(filters.colors, [expected]);
    assert.equal(serializeClimbFilters(filters), `color=${expected}`);
    assert.deepEqual(
      filterClimbs(boundaryClimbs, filters),
      filterClimbs(boundaryClimbs, filtersFor(`color=${expected}`)),
    );
  }
  assert.deepEqual(
    matchingGrades("color=yellow&min=6&max=6"),
    ["V5", "V7"],
  );
});

test("legacy reversed ranges expand to every overlapping band", () => {
  assert.deepEqual(filtersFor("min=7&max=3").colors, ["green", "yellow"]);
  assert.deepEqual(filtersFor("min=8&max=4").colors, ["green", "yellow", "red"]);
  assert.deepEqual(filtersFor("min=8&max=6").colors, ["yellow", "red"]);
  assert.deepEqual(filtersFor("min=7&max=5").colors, ["yellow"]);
});

test("unknown color values are ignored without narrowing to an exact grade", () => {
  assert.deepEqual(filtersFor("color=blue&color=yellow&color=RED").colors, ["yellow"]);
  assert.deepEqual(filtersFor("color=blue&min=6&max=6").colors, []);
  assert.deepEqual(matchingGrades("color=blue"), boundaryClimbs.map((climb) => climb.grade));
  assert.deepEqual(filtersFor("min=bad&max=bad").colors, []);
});

test("color filters round-trip while preserving all other filters", () => {
  const filters = filtersFor(
    "color=red&color=green&author=Sam&author=Alex&hold=hold-b&hold=hold-a&sent=hide&outdated=show&stars=4&rocko=approved&order=ascents",
  );
  const query =
    "color=green&color=red&author=Alex&author=Sam&hold=hold-a&hold=hold-b&sent=hide&outdated=show&stars=4&rocko=approved&order=ascents";
  assert.equal(serializeClimbFilters(filters), query);
  assert.deepEqual(filtersFor(query), filters);
  assert.deepEqual(
    parseClimbFilters({
      color: ["red", "green"],
      author: ["Sam", "Alex"],
      hold: ["hold-b", "hold-a"],
      sent: "hide",
      outdated: "show",
      stars: "4",
      rocko: "approved",
      order: "ascents",
    }),
    filters,
  );
  assert.equal(
    buildFilteredHref("/climbs/saved", filters, { id: "route-1" }),
    `/climbs/saved?${query}&id=route-1`,
  );
});

test("difficulty ordering uses newest first within each color band", () => {
  const filters = filtersFor("order=grade");
  const climbs = [
    { id: "v5", grade: "V5", createdAt: 10, activity: null },
    { id: "v0", grade: "V0", createdAt: 10, activity: null },
    { id: "v8", grade: "V8", createdAt: 10, activity: null },
    { id: "v17", grade: "V17", createdAt: 20, activity: null },
    { id: "v4", grade: "V4", createdAt: 20, activity: null },
    { id: "v7", grade: "V7", createdAt: 20, activity: null },
  ].sort((left, right) => compareClimbsByOrder(left, right, filters));
  assert.deepEqual(climbs.map((climb) => climb.id), ["v4", "v0", "v7", "v5", "v17", "v8"]);
  assert.equal(serializeClimbFilters(filters), "order=grade");
  assert.equal(hasClimbFilterConstraints(filters), false);
});

test("no color selection includes every difficulty by default", () => {
  const filters = filtersFor();
  assert.deepEqual(filters.colors, []);
  assert.equal(serializeClimbFilters(filters), "");
  assert.equal(activeClimbFilterCount(filters), 0);
  assert.equal(hasClimbFilterConstraints(filters), false);
  assert.deepEqual(matchingGrades(""), boundaryClimbs.map((climb) => climb.grade));
  assert.deepEqual(filtersFor("min=0&max=17"), filters);
});

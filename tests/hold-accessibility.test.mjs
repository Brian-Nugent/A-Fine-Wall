import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UserProfileProvider, { useActiveUser } from "../app/user-profile-provider.tsx";
import SetClimbPage from "../app/set-climb/page.tsx";
import SavedClimbDetail from "../app/climbs/saved/saved-climb-detail.tsx";
import { parseClimbFilters } from "../app/climbs/climb-filters.ts";

function ColorNames() {
  const { holdColorNames } = useActiveUser();
  return createElement("span", { "data-start-color": holdColorNames.start, "data-foot-color": holdColorNames.foot });
}
function render(profile, child = createElement(ColorNames)) {
  return renderToStaticMarkup(createElement(UserProfileProvider, { initialProfile: profile }, child));
}
const tony = { id: "tony-pep", name: "Tony Pep" };

test("Tony Pep gets the accessible hold palette immediately, including case variants and soft mode", () => {
  for (const profile of [tony, { ...tony, name: "tony pep" }, { ...tony, name: "  TONY   PEP  " }, { ...tony, softMode: true }]) {
    const html = render(profile);
    assert.match(html, /data-hold-palette="accessible"/);
    assert.match(html, /data-start-color="dark green"/);
    assert.match(html, /data-foot-color="orange"/);
  }
});

test("other users and signed-out screens keep the standard hold colors", () => {
  for (const profile of [null, { id: "other", name: "Admin" }, { id: "other", name: "TonyPep" }, { id: "other", name: "Tony Pep 2" }]) {
    const html = render(profile);
    assert.doesNotMatch(html, /data-hold-palette=/);
    assert.match(html, /data-start-color="green"/);
    assert.match(html, /data-foot-color="yellow"/);
  }
});

test("climb setting instructions match the active user's hold colors", () => {
  const accessible = render(tony, createElement(SetClimbPage));
  assert.match(accessible, /again for an orange foothold, then for a dark green start/);
  assert.match(accessible, /optional orange footholds, one or more dark green start holds/);
  assert.doesNotMatch(accessible, /yellow foothold|a green start/);
  const normal = render({ id: "other", name: "Alex" }, createElement(SetClimbPage));
  assert.match(normal, /again for a yellow foothold, then for a green start/);
  assert.doesNotMatch(normal, /orange foothold|dark green start/);
});

test("saved climb descriptions use the viewer's palette regardless of who set the climb", () => {
  const climb = {
    id: "palette-test", name: "Palette test", setter: "Alex", grade: "V3", createdAt: 1,
    holds: ["start", "foot", "hand", "finish"].map((role, index) => ({ role, x: 20 + index * 10, y: 30, size: 5 })),
  };
  const detail = createElement(SavedClimbDetail, {
    backHref: "/climbs", climbId: climb.id, initialClimb: climb,
    filters: parseClimbFilters(new URLSearchParams()),
  });
  const accessible = render(tony, detail);
  assert.match(accessible, /1 dark green-outlined start hold/);
  assert.match(accessible, /1 orange-outlined foothold/);
  const normal = render({ id: "other", name: "Alex" }, detail);
  assert.match(normal, /1 green-outlined start hold/);
  assert.match(normal, /1 yellow-outlined foothold/);
});

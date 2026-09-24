import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ClimbPhotoNavigation from "../app/climbs/climb-photo-navigation.tsx";

function renderNavigation(props) {
  return renderToStaticMarkup(
    createElement(ClimbPhotoNavigation, {
      hasPrevious: true,
      hasNext: true,
      onNavigate() {},
      ...props,
    }),
  );
}

function navigationButton(markup, direction) {
  const button = markup.match(
    new RegExp(`<button\\b(?=[^>]*aria-label="${direction} climb")[^>]*>`),
  )?.[0];
  assert.ok(button, `${direction} climb must be a labeled native button`);
  assert.match(button, /\btype="button"/);
  return button;
}

test("photo navigation exposes enabled previous and next buttons between climbs", () => {
  const markup = renderNavigation();
  assert.equal((markup.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(navigationButton(markup, "Previous"), /\bdisabled(?:=|\s|>)/);
  assert.doesNotMatch(navigationButton(markup, "Next"), /\bdisabled(?:=|\s|>)/);
});

test("photo navigation disables only the unavailable direction at each endpoint", () => {
  for (const [props, disabledDirection, enabledDirection] of [
    [{ hasPrevious: false }, "Previous", "Next"],
    [{ hasNext: false }, "Next", "Previous"],
  ]) {
    const markup = renderNavigation(props);
    assert.match(navigationButton(markup, disabledDirection), /\bdisabled=""/);
    assert.doesNotMatch(navigationButton(markup, enabledDirection), /\bdisabled(?:=|\s|>)/);
  }
});

test("photo navigation disables both directions when only one climb is available", () => {
  const markup = renderNavigation({ hasPrevious: false, hasNext: false });
  assert.match(navigationButton(markup, "Previous"), /\bdisabled=""/);
  assert.match(navigationButton(markup, "Next"), /\bdisabled=""/);
});

test("photo navigation disables both directions while a transition is busy", () => {
  const markup = renderNavigation({ busy: true });
  assert.match(navigationButton(markup, "Previous"), /\bdisabled=""/);
  assert.match(navigationButton(markup, "Next"), /\bdisabled=""/);
});

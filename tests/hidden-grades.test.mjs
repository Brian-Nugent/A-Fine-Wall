import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GradeBadge, { getGradeBand } from "../app/climbs/climb-grade.tsx";

function renderGradeBadge(grade, revealed, className, hasSends = true) {
  return renderToStaticMarkup(
    createElement(GradeBadge, { grade, revealed, className, hasSends }),
  );
}

test("grade bands include both ends of each difficulty range", () => {
  const boundaries = [
    ["V0", "green"],
    ["V4", "green"],
    ["V5", "yellow"],
    ["V7", "yellow"],
    ["V8", "red"],
    ["V17", "red"],
  ];

  for (const [grade, band] of boundaries) {
    assert.equal(getGradeBand(grade), band, grade);
    assert.match(
      renderGradeBadge(grade, false),
      new RegExp(`class="climb-grade climb-grade--${band}"`),
      grade,
    );
  }
});

test("climbs sent by other users show their band while hiding the exact grade", () => {
  const grades = [
    ["V2", "Green difficulty (V0–V4)"],
    ["V6", "Yellow difficulty (V5–V7)"],
    ["V12", "Red difficulty (V8 and up)"],
  ];

  for (const [grade, label] of grades) {
    const markup = renderGradeBadge(grade, false);
    assert.match(markup, /^<span\b[^>]*><\/span>$/);
    assert.ok(markup.includes(`aria-label="${label}. Grade hidden until sent."`));
    assert.match(markup, /role="img"/);
    assert.doesNotMatch(markup, /\btitle=/);
    assert.doesNotMatch(markup, new RegExp(`\\b${grade}\\b`));
  }
});

test("climbs with no logged sends stay gray in normal and soft mode", () => {
  for (const grade of ["V0", "V4", "V5", "V7", "V8", "V17"]) {
    for (const revealed of [false, true]) {
      const markup = renderGradeBadge(grade, revealed, "detail-grade", false);
      assert.match(markup, /class="climb-grade climb-grade--gray detail-grade"/);
      assert.match(markup, /No logged sends/);
      assert.doesNotMatch(markup, /Green difficulty|Yellow difficulty|Red difficulty/);
      assert.equal(markup.includes(`>${grade}</span>`), revealed);
    }
  }
});

test("the first logged send changes gray to the grade color without revealing the viewer's grade", () => {
  for (const [grade, color] of [["V2", "green"], ["V6", "yellow"], ["V12", "red"]]) {
    const unsent = renderGradeBadge(grade, false, undefined, false);
    const sentByAnotherUser = renderGradeBadge(grade, false, undefined, true);
    assert.match(unsent, /climb-grade--gray/);
    assert.match(sentByAnotherUser, new RegExp(`climb-grade--${color}`));
    assert.doesNotMatch(sentByAnotherUser, new RegExp(`>${grade}<`));
    assert.match(sentByAnotherUser, /Grade hidden until sent/);
    assert.doesNotMatch(sentByAnotherUser, /No logged sends/);
  }
});

test("sent grades appear inside the colored oval and its accessible label", () => {
  for (const grade of ["V0", "V4", "V5", "V7", "V8", "V17"]) {
    const markup = renderGradeBadge(grade, true);
    assert.match(markup, new RegExp(`>${grade}<\\/span>$`));
    assert.match(markup, new RegExp(`aria-label="${grade}\\. `));
    assert.match(markup, /role="img"/);
    assert.doesNotMatch(markup, /Grade hidden until sent/);
  }
});

test("revealing a grade preserves its color and oval classes", () => {
  for (const grade of ["V2", "V6", "V12"]) {
    const hidden = renderGradeBadge(grade, false, "detail-grade");
    const revealed = renderGradeBadge(grade, true, "detail-grade");
    const hiddenClass = hidden.match(/class="([^"]+)"/)?.[1];
    const revealedClass = revealed.match(/class="([^"]+)"/)?.[1];
    assert.equal(
      hiddenClass,
      `climb-grade climb-grade--${getGradeBand(grade)} detail-grade`,
    );
    assert.equal(revealedClass, hiddenClass);
  }
});

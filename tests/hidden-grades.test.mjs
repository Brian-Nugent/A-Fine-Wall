import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GradeBadge, { getGradeBand } from "../app/climbs/climb-grade.tsx";

function renderGradeBadge(grade, revealed, className) {
  return renderToStaticMarkup(
    createElement(GradeBadge, { grade, revealed, className }),
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

test("unsent grades render an empty oval with only accessible band information", () => {
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

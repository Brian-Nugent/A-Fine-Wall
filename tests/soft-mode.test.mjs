import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_USER_NAME_LENGTH, parseUserLogin, parseUserProfile, parseUserProfileCookie,
  persistUserProfile, readUserProfile, refreshUserProfile, serializeUserProfileCookie,
  USER_PROFILE_COOKIE_KEY,
} from "../app/user-profile.ts";
import { createUserProfile, loadUserProfile } from "../app/user-api.ts";
import UserProfileProvider from "../app/user-profile-provider.tsx";
import { ClimbActivityProvider, ClimbDetailGrade, useClimbActivity } from "../app/climbs/climb-activity-context.tsx";
import ClimbListClient from "../app/climbs/climb-list-client.tsx";
import { parseClimbFilters } from "../app/climbs/climb-filters.ts";

const sheafy = { id: "profile-sheafy", name: "Sheafy" };
const softSheafy = { ...sheafy, softMode: true };

test("soft login recognizes a separate, case-insensitive prefix and validates the underlying name", () => {
  for (const name of ["soft Sheafy", "  SOFT   Sheafy  ", "Soft Sheafy"]) {
    assert.deepEqual(parseUserLogin(name), { name: "Sheafy", softMode: true });
  }
  assert.deepEqual(parseUserLogin("Sheafy"), { name: "Sheafy", softMode: false });
  assert.deepEqual(parseUserLogin("Softball"), { name: "Softball", softMode: false });
  assert.deepEqual(parseUserLogin("soft Zoë O’Connor"), { name: "Zoë O’Connor", softMode: true });
  assert.deepEqual(parseUserLogin(`soft ${"x".repeat(MAX_USER_NAME_LENGTH)}`), {
    name: "x".repeat(MAX_USER_NAME_LENGTH), softMode: true,
  });
  for (const invalid of [null, "", "soft", "soft   ", "soft You", "soft Bad\nName", "soft Bad\u200bName", `soft ${"x".repeat(51)}`]) {
    assert.equal(parseUserLogin(invalid), null);
  }
});

test("soft mode survives storage, cookies, and identity refresh; ordinary login clears it", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  persistUserProfile(storage, softSheafy);
  assert.deepEqual(readUserProfile(storage), softSheafy);
  assert.deepEqual(parseUserProfileCookie(`${USER_PROFILE_COOKIE_KEY}=${serializeUserProfileCookie(softSheafy)}`), softSheafy);
  assert.deepEqual(refreshUserProfile(sheafy, softSheafy), softSheafy);
  assert.deepEqual(refreshUserProfile({ ...sheafy, id: "canonical-id" }, softSheafy), { ...softSheafy, id: "canonical-id" });
  assert.deepEqual(refreshUserProfile(softSheafy, sheafy), sheafy);
  persistUserProfile(storage, sheafy);
  assert.deepEqual(readUserProfile(storage), sheafy);
  for (const softMode of [false, "true", 1]) {
    assert.deepEqual(parseUserProfile(JSON.stringify({ ...sheafy, softMode })), sheafy);
  }
});

test("login client keeps the session flag while profile reads remain canonical", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      assert.equal(JSON.parse(options.body).name, "soft Sheafy");
      return Response.json({ profile: softSheafy });
    }
    return Response.json({ profile: sheafy });
  };
  try {
    assert.deepEqual(await createUserProfile("soft Sheafy"), softSheafy);
    assert.deepEqual(await loadUserProfile(sheafy.id), sheafy);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function renderWithProfile(profile, child) {
  return renderToStaticMarkup(createElement(UserProfileProvider, { initialProfile: profile }, child));
}

function SendState() {
  const { hasSent } = useClimbActivity();
  return createElement("span", { "data-has-sent": String(hasSent) });
}

test("soft mode reveals unsent detail grades immediately without marking the climb sent", () => {
  const detail = createElement(ClimbActivityProvider, { reference: { climbKind: "saved", climbId: "unsent-route" } },
    createElement(ClimbDetailGrade, { grade: "V6", className: "detail-grade" }), createElement(SendState));
  const normal = renderWithProfile(sheafy, detail);
  assert.match(normal, /Grade hidden until sent/);
  assert.doesNotMatch(normal, />V6</);
  const soft = renderWithProfile(softSheafy, detail);
  assert.match(soft, />V6<\/span>/);
  assert.match(soft, /climb-grade--yellow detail-grade/);
  assert.doesNotMatch(soft, /Grade hidden until sent/);
  assert.match(soft, /data-has-sent="false"/);
  const signedOut = renderWithProfile(null, detail);
  assert.doesNotMatch(signedOut, />V6</);
});

test("main climb heading labels soft mode while displaying the canonical user name", () => {
  const list = createElement(ClimbListClient, { initialFilters: parseClimbFilters(new URLSearchParams()) });
  const soft = renderWithProfile(softSheafy, list);
  assert.match(soft, /<h1 id="climbs-heading">Climbs<\/h1><span class="soft-mode-label">soft mode enabled<\/span>/);
  assert.match(soft, /Using Sheafy/);
  assert.doesNotMatch(soft, /Using soft Sheafy/);
  assert.doesNotMatch(renderWithProfile(sheafy, list), /soft mode enabled/);
});

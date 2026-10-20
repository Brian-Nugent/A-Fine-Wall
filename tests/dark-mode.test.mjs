import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_USER_LOGIN_LENGTH, MAX_USER_NAME_LENGTH, parseUserLogin, parseUserProfile, parseUserProfileCookie,
  persistUserProfile, readUserProfile, refreshUserProfile, serializeUserProfileCookie,
  USER_PROFILE_COOKIE_KEY,
} from "../app/user-profile.ts";
import { themeForProfile } from "../app/theme-preference.ts";

const sheafy = { id: "profile-sheafy", name: "Sheafy" };
const darkSheafy = { ...sheafy, darkMode: true };

test("dark login recognizes a separate, case-insensitive prefix and combines with soft in either order", () => {
  for (const name of ["dark Sheafy", "  DARK   Sheafy  ", "Dark Sheafy"]) {
    assert.deepEqual(parseUserLogin(name), { name: "Sheafy", softMode: false, darkMode: true });
  }
  for (const name of ["soft dark Sheafy", "dark soft Sheafy", "  DARK  SOFT Sheafy"]) {
    assert.deepEqual(parseUserLogin(name), { name: "Sheafy", softMode: true, darkMode: true });
  }
  assert.deepEqual(parseUserLogin("Darkwing"), { name: "Darkwing", softMode: false, darkMode: false });
  assert.deepEqual(parseUserLogin("dark dark Sheafy"), { name: "dark Sheafy", softMode: false, darkMode: true });
  const longName = "x".repeat(MAX_USER_NAME_LENGTH);
  assert.equal(`soft dark ${longName}`.length, MAX_USER_LOGIN_LENGTH);
  assert.deepEqual(parseUserLogin(`soft dark ${longName}`), { name: longName, softMode: true, darkMode: true });
  for (const invalid of ["dark", "dark   ", "soft dark", "dark You", "dark Bad\nName", `dark ${"x".repeat(51)}`]) {
    assert.equal(parseUserLogin(invalid), null);
  }
});

test("dark mode survives storage, cookies, and identity refresh; ordinary login clears it", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  persistUserProfile(storage, darkSheafy);
  assert.deepEqual(readUserProfile(storage), darkSheafy);
  assert.deepEqual(parseUserProfileCookie(`${USER_PROFILE_COOKIE_KEY}=${serializeUserProfileCookie(darkSheafy)}`), darkSheafy);
  assert.deepEqual(refreshUserProfile(sheafy, darkSheafy), darkSheafy);
  assert.deepEqual(refreshUserProfile(sheafy, { ...darkSheafy, softMode: true }), { ...darkSheafy, softMode: true });
  assert.deepEqual(refreshUserProfile(darkSheafy, sheafy), sheafy);
  for (const darkMode of [false, "true", 1]) {
    assert.deepEqual(parseUserProfile(JSON.stringify({ ...sheafy, darkMode })), sheafy);
  }
});

test("only a dark login picks the dark theme", () => {
  assert.equal(themeForProfile(darkSheafy), "dark");
  assert.equal(themeForProfile(sheafy), "light");
  assert.equal(themeForProfile({ ...sheafy, softMode: true }), "light");
  assert.equal(themeForProfile(null), "light");
});

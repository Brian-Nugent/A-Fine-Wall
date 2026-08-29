import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  addSavedClimb,
  attributeSavedClimb,
  CLIMB_GRADES,
  isClimbGrade,
  nextSavedHoldRole,
  parseSavedClimbs,
  persistSavedClimb,
  persistSavedClimbs,
  readSavedClimbs,
  removeSavedClimb,
} from "../app/climbs/saved-climbs.ts";
import {
  activeClimbFilterCount,
  adjacentClimbIds,
  buildFilteredHref,
  compareClimbsByOrder,
  filterClimbs,
  hasClimbFilterConstraints,
  matchesClimbActivityFilters,
  matchesClimbFilters,
  parseClimbFilters,
  requiresClimbActivity,
  selectVisibleClimbs,
  serializeClimbFilters,
  uniqueFilterAuthors,
} from "../app/climbs/climb-filters.ts";
import {
  CLIMB_NAVIGATION_SNAPSHOT_KEY,
  adjacentClimbReferences,
  adjacentClimbReferencesInOrder,
  clearClimbNavigationSnapshot,
  clearSessionClimbNavigationSnapshot,
  parseClimbNavigationSnapshot,
  readClimbNavigationSnapshot,
  readSessionClimbNavigationSnapshot,
  writeClimbNavigationSnapshot,
  writeSessionClimbNavigationSnapshot,
} from "../app/climbs/climb-navigation-snapshot.ts";
import {
  horizontalSwipeDirection,
  updateSwipeIntent,
} from "../app/climbs/swipe-gesture.ts";
import {
  getClimbListState,
  matchesClimbSearch,
} from "../app/climbs/climb-list-state.ts";
import {
  climbActivityKey,
  DEMO_CLIMB_IDS,
  findClimbActivity,
  formatAverageRating,
  isClimbReference,
  parseClimbActivityDetailPayload,
  parseClimbActivitiesPayload,
} from "../app/climbs/climb-activity.ts";
import { climbs as demoClimbs } from "../app/climbs/data.ts";
import {
  reconcileBrowserClimbsAfterWallSave,
  resolveSavedHold,
  wallHoldSizeFromHorizontalDrag,
  wallSetupReturnPath,
} from "../app/climbs/wall-holds.ts";
import {
  MAX_USER_NAME_LENGTH,
  USER_PROFILE_COOKIE_KEY,
  USER_PROFILE_KEY,
  normalizeUserName,
  parseUserProfileCookie,
  parseUserProfile,
  persistUserProfile,
  readUserProfile,
  removeUserProfile,
  resolveCachedUserProfile,
  serializeUserProfileCookie,
} from "../app/user-profile.ts";
import {
  ACTIVE_USER_PROFILE_HEADER,
  canManageClimb,
  isAdminUser,
  isAdminUserName,
  isSameUserName,
} from "../app/user-access.ts";

async function render(pathname = "/", requestHeaders = {}) {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...requestHeaders },
    }),
    createEnvironment(),
    createContext(),
  );
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function createEnvironment(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    ...overrides,
  };
}

function createContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

function createMemoryWallPhotoBucket() {
  let stored = null;

  return {
    async delete(key) {
      if (stored?.key === key) stored = null;
    },
    async get(key) {
      if (!stored || stored.key !== key) return null;

      const { bytes, contentType } = stored;
      return {
        body: new Blob([bytes]).stream(),
        size: bytes.byteLength,
        httpEtag: '"wall-photo-test"',
        httpMetadata: { contentType },
        writeHttpMetadata(headers) {
          headers.set("Content-Type", contentType);
        },
      };
    },
    async put(key, value, options) {
      stored = {
        key,
        bytes: new Uint8Array(value.slice(0)),
        contentType: options.httpMetadata.contentType,
      };
    },
  };
}

function createMemoryAppDatabase() {
  let wallConfiguration = null;
  let schemaBatchCount = 0;
  let climbsTableExists = false;
  let climbsHaveRockoApproval = false;
  let climbSendsTableExists = false;
  let climbSendsHaveGrade = false;
  const savedClimbs = new Map();
  const deletedClimbs = new Map();
  const savedProfiles = new Map();
  const savedSends = new Map();

  const memorySendKey = (climbKind, climbId, profileId) =>
    JSON.stringify([climbKind, climbId, profileId]);
  const memoryProfileNameKey = (name) => name.toLocaleLowerCase("en-US");

  function aggregateSends(climbKind, climbId, profileId = null) {
    const matching = [...savedSends.values()].filter(
      (send) =>
        send.climb_kind === climbKind && send.climb_id === climbId,
    );
    if (matching.length === 0) return null;
    return {
      climb_kind: climbKind,
      climb_id: climbId,
      average_rating:
        Math.round(
          (matching.reduce((total, send) => total + send.rating, 0) /
            matching.length) *
            10,
        ) / 10,
      rating_count: matching.length,
      ...(profileId
        ? {
            user_rating:
              matching.find((send) => send.profile_id === profileId)?.rating ??
              null,
          }
        : {}),
    };
  }

  function consensusGrade(climbId) {
    const grades = [...savedSends.values()].flatMap((send) =>
      send.climb_kind === "saved" &&
      send.climb_id === climbId &&
      typeof send.grade === "string"
        ? [Number(send.grade.slice(1))]
        : [],
    );
    return grades.length === 0
      ? null
      : {
          climb_id: climbId,
          consensus_grade: Math.round(
            grades.reduce((total, grade) => total + grade, 0) / grades.length,
          ),
        };
  }

  function createStatement(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    return {
      bind(...nextValues) {
        return createStatement(sql, nextValues);
      },
      async all() {
        if (normalized === "pragma table_info(climbs)") {
          return {
            results: climbsHaveRockoApproval
              ? [{ name: "rocko_approved" }]
              : [],
          };
        }
        if (normalized === "pragma table_info(climb_sends)") {
          return {
            results: climbSendsHaveGrade ? [{ name: "grade" }] : [],
          };
        }
        if (
          normalized.includes("as consensus_grade") &&
          normalized.includes("from climb_sends") &&
          normalized.includes("group by climb_id")
        ) {
          const climbIds = new Set(
            [...savedSends.values()]
              .filter(
                (send) => send.climb_kind === "saved" && send.grade !== null,
              )
              .map((send) => send.climb_id),
          );
          return {
            results: [...climbIds].flatMap((climbId) => {
              const consensus = consensusGrade(climbId);
              return consensus ? [consensus] : [];
            }),
          };
        }
        if (normalized.includes("from climbs order by created_at desc")) {
          return {
            results: [...savedClimbs.values()].sort(
              (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
            ),
          };
        }
        if (normalized === "select id, holds_json from climbs") {
          return {
            results: [...savedClimbs.values()].map(({ id, holds_json }) => ({
              id,
              holds_json,
            })),
          };
        }
        if (
          normalized.includes("from profiles as current") &&
          normalized.includes("where not exists")
        ) {
          const profilesByName = new Map();
          for (const profile of savedProfiles.values()) {
            const nameKey = memoryProfileNameKey(profile.name);
            const current = profilesByName.get(nameKey);
            if (
              !current ||
              profile.created_at < current.created_at ||
              (profile.created_at === current.created_at &&
                profile.id.localeCompare(current.id) < 0)
            ) {
              profilesByName.set(nameKey, profile);
            }
          }
          return {
            results: [...profilesByName.values()]
              .sort(
                (a, b) =>
                  a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base",
                  }) ||
                  a.created_at - b.created_at ||
                  a.id.localeCompare(b.id),
              )
              .slice(0, 200),
          };
        }
        if (
          normalized.includes("from climb_sends as send") &&
          normalized.includes("join profiles as profile")
        ) {
          const matching = [...savedSends.values()]
            .filter(
              (send) =>
                send.climb_kind === values[0] &&
                send.climb_id === values[1] &&
                savedProfiles.has(send.profile_id),
            )
            .sort((left, right) => {
              const leftProfile = savedProfiles.get(left.profile_id);
              const rightProfile = savedProfiles.get(right.profile_id);
              return (
                right.sent_at - left.sent_at ||
                leftProfile.name.localeCompare(rightProfile.name, undefined, {
                  sensitivity: "base",
                }) ||
                leftProfile.id.localeCompare(rightProfile.id)
              );
            });
          return {
            results: matching.map((send) => ({
              profile_id: send.profile_id,
              profile_name: savedProfiles.get(send.profile_id).name,
              grade: send.grade,
              rating: send.rating,
            })),
          };
        }
        if (
          normalized.includes("from climb_sends") &&
          normalized.includes("group by climb_kind, climb_id") &&
          !normalized.includes("where climb_kind = ?")
        ) {
          const references = new Map();
          for (const send of savedSends.values()) {
            references.set(
              JSON.stringify([send.climb_kind, send.climb_id]),
              [send.climb_kind, send.climb_id],
            );
          }
          return {
            results: [...references.values()]
              .sort(
                ([leftKind, leftId], [rightKind, rightId]) =>
                  leftKind.localeCompare(rightKind) ||
                  leftId.localeCompare(rightId),
              )
              .map(([climbKind, climbId]) =>
                aggregateSends(climbKind, climbId, values[0]),
              ),
          };
        }
        throw new Error(`Unsupported all query: ${normalized}`);
      },
      async first() {
        if (
          normalized.startsWith("insert into profiles") &&
          normalized.includes("where not exists")
        ) {
          const [id, name, createdAt, expectedName] = values;
          if (
            name !== expectedName ||
            [...savedProfiles.values()].some(
              (profile) =>
                memoryProfileNameKey(profile.name) ===
                memoryProfileNameKey(expectedName),
            )
          ) {
            return null;
          }
          const profile = { id, name, created_at: createdAt };
          savedProfiles.set(id, profile);
          return profile;
        }
        if (normalized.startsWith("insert into climb_sends")) {
          const [
            climbKind,
            climbId,
            profileId,
            grade,
            rating,
            sentAt,
            updatedAt,
            expectedClimbId,
          ] = values;
          if (
            normalized.includes("where exists") &&
            (!savedClimbs.has(expectedClimbId) || climbId !== expectedClimbId)
          ) {
            return null;
          }
          const key = memorySendKey(climbKind, climbId, profileId);
          const existing = savedSends.get(key);
          const send = {
            climb_kind: climbKind,
            climb_id: climbId,
            profile_id: profileId,
            grade,
            rating,
            sent_at: existing?.sent_at ?? sentAt,
            updated_at: updatedAt,
          };
          savedSends.set(key, send);
          return send;
        }
        if (
          normalized.includes("as consensus_grade") &&
          normalized.includes("from climb_sends") &&
          normalized.includes("group by climb_id")
        ) {
          return consensusGrade(values[0]);
        }
        if (
          normalized.includes("from climb_sends") &&
          normalized.includes("where climb_kind = ? and climb_id = ?")
        ) {
          return aggregateSends(values[0], values[1]);
        }
        if (
          normalized.startsWith("insert into climbs") &&
          normalized.endsWith("returning id")
        ) {
          if (
            !wallConfiguration ||
            wallConfiguration.updated_at !== values[7] ||
            deletedClimbs.has(values[8])
          ) {
            return null;
          }
          if (savedClimbs.has(values[0])) {
            throw new Error("UNIQUE constraint failed: climbs.id");
          }
          savedClimbs.set(values[0], {
            id: values[0],
            name: values[1],
            grade: values[2],
            setter: values[3],
            created_at: values[4],
            holds_json: values[5],
            rocko_approved: 0,
          });
          return { id: values[0] };
        }
        if (
          normalized.startsWith("update wall_configuration set") &&
          normalized.endsWith("returning updated_at")
        ) {
          if (!wallConfiguration || wallConfiguration.updated_at !== values[3]) {
            return null;
          }
          wallConfiguration = {
            holds_json: values[0],
            updated_at: values[1],
          };
          return { updated_at: values[1] };
        }
        if (
          normalized.startsWith("update climbs set name = ?") &&
          normalized.endsWith(
            "returning id, name, grade, setter, created_at, holds_json, rocko_approved",
          )
        ) {
          const climb = savedClimbs.get(values[3]);
          if (
            !climb ||
            !wallConfiguration ||
            wallConfiguration.updated_at !== values[5]
          ) {
            return null;
          }
          climb.name = values[0];
          climb.grade = values[1];
          climb.holds_json = values[2];
          return climb;
        }
        if (
          normalized.startsWith("update climbs set rocko_approved = ?") &&
          normalized.endsWith(
            "returning id, name, grade, setter, created_at, holds_json, rocko_approved",
          )
        ) {
          const climb = savedClimbs.get(values[1]);
          if (!climb) return null;
          climb.rocko_approved = values[0];
          return climb;
        }
        if (normalized.includes("from wall_configuration where id = ?")) {
          return wallConfiguration;
        }
        if (normalized === "select id from climbs where id = ?") {
          return savedClimbs.has(values[0]) ? { id: values[0] } : null;
        }
        if (normalized === "select id from deleted_climbs where id = ?") {
          return deletedClimbs.has(values[0]) ? { id: values[0] } : null;
        }
        if (
          normalized ===
          "select id, name, created_at from profiles where id = ?"
        ) {
          return savedProfiles.get(values[0]) ?? null;
        }
        if (
          normalized.includes("from profiles as requested") &&
          normalized.includes("join profiles as canonical")
        ) {
          const requested = savedProfiles.get(values[0]);
          if (!requested) return null;
          return (
            [...savedProfiles.values()]
              .filter(
                (profile) =>
                  memoryProfileNameKey(profile.name) ===
                  memoryProfileNameKey(requested.name),
              )
              .sort(
                (a, b) =>
                  a.created_at - b.created_at || a.id.localeCompare(b.id),
              )[0] ?? null
          );
        }
        if (
          normalized.includes("from profiles where name = ?") &&
          normalized.includes("order by created_at asc")
        ) {
          return (
            [...savedProfiles.values()]
              .filter(
                (profile) =>
                  memoryProfileNameKey(profile.name) ===
                  memoryProfileNameKey(values[0]),
              )
              .sort(
                (a, b) =>
                  a.created_at - b.created_at || a.id.localeCompare(b.id),
              )[0] ?? null
          );
        }
        if (normalized.includes("from climbs where id = ?")) {
          return savedClimbs.get(values[0]) ?? null;
        }
        throw new Error(`Unsupported first query: ${normalized}`);
      },
      async run() {
        if (normalized.startsWith("create table if not exists climbs")) {
          if (!climbsTableExists) {
            climbsTableExists = true;
            climbsHaveRockoApproval = normalized.includes("rocko_approved");
          }
          return { success: true };
        }
        if (normalized.startsWith("create table if not exists climb_sends")) {
          if (!climbSendsTableExists) {
            climbSendsTableExists = true;
            climbSendsHaveGrade = normalized.includes("grade text");
          }
          return { success: true };
        }
        if (normalized.startsWith("create table") || normalized.startsWith("create index")) {
          return { success: true };
        }
        if (normalized.startsWith("alter table climb_sends add column grade")) {
          climbSendsHaveGrade = true;
          for (const send of savedSends.values()) send.grade ??= null;
          return { success: true };
        }
        if (normalized.startsWith("alter table climbs add column rocko_approved")) {
          climbsHaveRockoApproval = true;
          for (const climb of savedClimbs.values()) {
            climb.rocko_approved = 0;
          }
          return { success: true };
        }
        if (normalized.startsWith("insert or ignore into wall_configuration")) {
          wallConfiguration ??= {
            holds_json: values[1],
            updated_at: values[2],
          };
          return { success: true };
        }
        if (normalized.startsWith("insert into profiles")) {
          savedProfiles.set(values[0], {
            id: values[0],
            name: values[1],
            created_at: values[2],
          });
          return { success: true };
        }
        if (normalized.startsWith("update wall_configuration set")) {
          wallConfiguration = {
            holds_json: values[0],
            updated_at: values[1],
          };
          return { success: true };
        }
        if (normalized.startsWith("insert into climbs")) {
          if (savedClimbs.has(values[0])) {
            throw new Error("UNIQUE constraint failed: climbs.id");
          }
          savedClimbs.set(values[0], {
            id: values[0],
            name: values[1],
            grade: values[2],
            setter: values[3],
            created_at: values[4],
            holds_json: values[5],
            rocko_approved: 0,
          });
          return { success: true };
        }
        if (normalized.startsWith("update climbs set holds_json")) {
          const climb = savedClimbs.get(values[1]);
          if (climb) climb.holds_json = values[0];
          return { success: true };
        }
        if (normalized.startsWith("update climbs set setter")) {
          const climb = savedClimbs.get(values[2]);
          if (climb?.setter === values[3]) {
            climb.setter = values[0];
            climb.holds_json = values[1];
          }
          return { success: true };
        }
        if (normalized.startsWith("insert or ignore into deleted_climbs")) {
          if (!deletedClimbs.has(values[0])) {
            deletedClimbs.set(values[0], values[1]);
          }
          return { success: true };
        }
        if (normalized.startsWith("delete from climbs where id = ?")) {
          savedClimbs.delete(values[0]);
          return { success: true };
        }
        if (
          normalized ===
          "delete from climb_sends where climb_kind = ? and climb_id = ? and profile_id = ?"
        ) {
          savedSends.delete(memorySendKey(values[0], values[1], values[2]));
          return { success: true };
        }
        if (
          normalized.startsWith(
            "delete from climb_sends where climb_kind = ? and climb_id = ?",
          )
        ) {
          for (const [key, send] of savedSends) {
            if (
              send.climb_kind === values[0] &&
              send.climb_id === values[1]
            ) {
              savedSends.delete(key);
            }
          }
          return { success: true };
        }
        throw new Error(`Unsupported run query: ${normalized}`);
      },
    };
  }

  return {
    prepare(sql) {
      return createStatement(sql);
    },
    async batch(statements) {
      schemaBatchCount += 1;
      return Promise.all(statements.map((statement) => statement.run()));
    },
    schemaBatchCount() {
      return schemaBatchCount;
    },
    seedClimb(climb) {
      climbsTableExists = true;
      savedClimbs.set(climb.id, {
        id: climb.id,
        name: climb.name,
        grade: climb.grade,
        setter: climb.setter,
        created_at: climb.createdAt,
        holds_json: JSON.stringify(climb.holds),
        rocko_approved: 0,
      });
    },
    seedProfile(profile) {
      savedProfiles.set(profile.id, {
        id: profile.id,
        name: profile.name,
        created_at: profile.createdAt,
      });
    },
    seedSend(send) {
      climbSendsTableExists = true;
      savedSends.set(
        memorySendKey(send.climbKind, send.climbId, send.profileId),
        {
          climb_kind: send.climbKind,
          climb_id: send.climbId,
          profile_id: send.profileId,
          grade: send.grade ?? null,
          rating: send.rating,
          sent_at: send.sentAt,
          updated_at: send.updatedAt,
        },
      );
    },
    sendCount() {
      return savedSends.size;
    },
    sendFor(climbKind, climbId, profileId) {
      const send = savedSends.get(
        memorySendKey(climbKind, climbId, profileId),
      );
      return send ? { ...send } : null;
    },
  };
}

test("starts at the climb list while preserving the first-time profile gate", async () => {
  const response = await render();
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/climbs");

  const [homeSource, profileSource, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/user-profile-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(homeSource, /redirect\("\/climbs"\)/);
  assert.doesNotMatch(homeSource, /View Climbs|home-page/);
  assert.match(profileSource, /What's your name\?/);
  assert.doesNotMatch(profileSource, /Opening the wall|profile-gate--loading/);
  assert.doesNotMatch(css, /\.home-page/);
  assert.doesNotMatch(css, /\.profile-gate--loading/);
});

test("restores returning users without a branded loading screen", async () => {
  const profile = { id: "profile-cookie-test", name: "Cookie Tester" };
  const cookie = `${USER_PROFILE_COOKIE_KEY}=${serializeUserProfileCookie(profile)}`;
  const response = await render("/climbs", { cookie });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Current user: Cookie Tester/);
  assert.match(html, /Loading climbs/);
  assert.doesNotMatch(html, /Opening the wall|profile-gate--loading/);

  const firstVisitResponse = await render("/climbs");
  assert.equal(firstVisitResponse.status, 200);
  assert.doesNotMatch(
    await firstVisitResponse.text(),
    /Opening the wall|profile-gate--loading/,
  );
});

test("recognizes Admin and climb owners without case sensitivity", () => {
  assert.equal(isAdminUserName("Admin"), true);
  assert.equal(isAdminUserName("admin"), true);
  assert.equal(isAdminUserName("aDmIn"), true);
  assert.equal(isAdminUserName("Administrator"), false);
  assert.equal(isAdminUser(null), false);
  assert.equal(isAdminUser({ name: "ADMIN" }), true);
  assert.equal(isSameUserName(" Sheafy ", "sHEAFY"), true);
  assert.equal(canManageClimb({ name: "Sheafy" }, "sHEAFY"), true);
  assert.equal(canManageClimb({ name: "Alex" }, "Sheafy"), false);
  assert.equal(canManageClimb({ name: "admin" }, "Sheafy"), true);
});

test("guards every wall setup entry point with the Admin rule", async () => {
  const sources = await Promise.all(
    [
      "../app/climbs/climb-list-client.tsx",
      "../app/set-climb/page.tsx",
      "../app/climbs/filter/holds/hold-filter-client.tsx",
      "../app/wall-photo/page.tsx",
      "../app/wall-holds/page.tsx",
    ].map((relativePath) =>
      readFile(new URL(relativePath, import.meta.url), "utf8"),
    ),
  );

  for (const source of sources) {
    assert.match(source, /isAdminUser\(profile\)/);
  }
  assert.match(sources[3], /<h1>Admin only<\/h1>/);
  assert.match(sources[4], /<h1>Admin only<\/h1>/);
});

test("renders the shared-climb shell without prototype climbs", async () => {
  const response = await render("/climbs");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.doesNotMatch(html, /href="\/wall-photo"/i);
  assert.match(html, /href="\/set-climb"/i);
  assert.match(html, />Set Climb<\/a>/i);
  assert.match(html, /href="\/climbs\/filter"/i);
  assert.match(html, /role="search"/i);
  assert.match(html, /<label[^>]*for="climb-search-input"[^>]*>\s*Search climbs by name\s*<\/label>/i);
  assert.match(html, /<input[^>]*id="climb-search-input"[^>]*placeholder="Search climbs"[^>]*type="search"/i);
  assert.match(html, /Loading climbs/);
  for (const [slug, name, setter] of [
    ["first-light", "First Light", "Ben"],
    ["barn-door-protocol", "Barn Door Protocol", "Maya"],
    ["quiet-feet", "Quiet Feet", "Sam"],
    ["static-bloom", "Static Bloom", "Lena"],
    ["redline", "Redline", "Jordan"],
  ]) {
    assert.doesNotMatch(html, new RegExp(`href="/climbs/${slug}"`, "i"));
    assert.doesNotMatch(html, new RegExp(name));
    assert.doesNotMatch(html, new RegExp(`Set by ${setter}`));
  }
});

test("searches climb names with trimmed case-insensitive substrings", () => {
  assert.equal(matchesClimbSearch("I Hardly Know Her", "hardly"), true);
  assert.equal(matchesClimbSearch("New and Slick", "  SLICK  "), true);
  assert.equal(matchesClimbSearch("Ol’ Topper", "ol’"), true);
  assert.equal(matchesClimbSearch("Corner Pocket", "corner pocket"), true);
  assert.equal(matchesClimbSearch("Corner Pocket", "corner pockets"), false);
  assert.equal(matchesClimbSearch("Any Climb", "   "), true);
});

test("keeps search results in the climb swipe snapshot", async () => {
  const source = await readFile(
    new URL("../app/climbs/climb-list-client.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const searchedClimbs = filteredClimbs\.filter/);
  assert.match(
    source,
    /writeSessionClimbNavigationSnapshot\([\s\S]*searchedClimbs\.map\(\(entry\) => entry\.reference\)/,
  );
  assert.match(source, /\{searchedClimbs\.map\(\(entry\) => \(/);
  assert.match(source, /No climbs match your search/);
  assert.match(source, />\s*Clear Search\s*</);
});

test("renders the climb filter controls and applies URL filters", async () => {
  let response = await render("/climbs");
  assert.equal(response.status, 200);
  let html = await response.text();
  assert.match(html, /href="\/climbs\/filter"/i);
  assert.match(html, />Filter<\/a>/i);
  assert.match(html, /class="small-brand" href="\/climbs"/i);
  assert.doesNotMatch(html, /aria-label="Clear all filters"/i);

  response = await render("/climbs?min=3&max=3");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /Loading climbs/);
  assert.match(
    html,
    /class="small-brand" href="\/climbs\?min=3&amp;max=3"/i,
  );
  assert.match(
    html,
    /aria-label="Clear all filters"[^>]*href="\/climbs"/i,
  );
  assert.match(
    html,
    /class="filter-link" href="\/climbs\/filter\?min=3&amp;max=3"/i,
  );
  assert.doesNotMatch(html, /First Light/);
  assert.doesNotMatch(html, /Barn Door Protocol/);
  assert.doesNotMatch(html, /Static Bloom/);
  assert.doesNotMatch(html, /Redline/);

  const climbListSource = await readFile(
    new URL("../app/climbs/climb-list-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(climbListSource, /onClick=\{reloadClimbList\}/);
  assert.match(climbListSource, /window\.location\.reload\(\)/);
  assert.match(climbListSource, /No climbs match these filters/);
  assert.match(climbListSource, />\s*Clear Filters\s*</);
  assert.match(
    climbListSource,
    /rockoApproved:\s*climb\.rockoApproved === true/,
  );
  assert.doesNotMatch(
    climbListSource,
    /Try a wider grade range or remove a hold or author\./,
  );

  response = await render("/climbs?hold=stable-hold");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /Loading climbs/);
  assert.doesNotMatch(html, /No climbs match these filters/);

  response = await render(
    "/climbs/filter?min=2&max=9&outdated=show&rocko=approved",
  );
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /<h1 id="filter-heading">Filter climbs<\/h1>/);
  assert.match(html, /type="range"/);
  assert.match(html, /Minimum/);
  assert.match(html, /Maximum/);
  assert.match(html, /Hide climbs I have sent/);
  assert.match(html, /<h2 id="wall-status-filter-heading">Wall status<\/h2>/);
  assert.match(html, /Show outdated climbs/);
  const showOutdatedInput =
    html.match(/<input[^>]*id="show-outdated-climbs"[^>]*>/)?.[0] ?? "";
  assert.match(showOutdatedInput, /checked=""/);
  assert.doesNotMatch(html, /Hide sent climbs/);
  assert.doesNotMatch(html, /Only show climbs you have not logged\./);
  assert.match(html, /Minimum community rating/);
  assert.match(html, /Show only Rocko Approved climbs/);
  assert.match(
    html,
    /<label[^>]*class="filter-rocko-approved-label"[^>]*for="rocko-approved-climbs"[^>]*>[\s\S]*Show only Rocko Approved climbs[\s\S]*class="rocko-approved-icon rocko-approved-filter-icon"/,
  );
  const rockoApprovedInput =
    html.match(/<input[^>]*id="rocko-approved-climbs"[^>]*>/)?.[0] ?? "";
  assert.match(rockoApprovedInput, /checked=""/);
  assert.match(html, /Most ascents/);
  assert.match(html, /Choose Holds/);
  assert.match(html, /<h2 id="order-filter-heading">Order<\/h2>/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /<h2 id="author-filter-heading">Setter<\/h2>/);
  assert.match(html, /No selection includes every setter\./);
  assert.doesNotMatch(html, /No selection includes every author\./);
  assert.match(html, /role="group"/);
  assert.match(html, /class="filter-scroll-region"/);
  assert.match(html, /class="filter-apply-spinner"/);
  assert.match(html, /class="filter-apply-spinner-indicator"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /<legend>(?:Order|Setter)<\/legend>/);
  assert.doesNotMatch(html, /Use your sends and the community rating\./);
  for (const fakeAuthor of ["Ben", "Maya", "Sam", "Lena", "Jordan"]) {
    assert.doesNotMatch(html, new RegExp(`>${fakeAuthor}<`));
  }

  const filterOptionsSource = await readFile(
    new URL(
      "../app/climbs/filter/filter-options-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    filterOptionsSource,
    /availableClimbs\.map\(\(\{ climb \}\) => climb\.setter\)/,
  );
  assert.doesNotMatch(filterOptionsSource, /loadUserProfiles/);
  assert.doesNotMatch(filterOptionsSource, /loadedAuthors/);
  assert.doesNotMatch(
    filterOptionsSource,
    /Use your sends and the community rating\./,
  );
  assert.match(
    filterOptionsSource,
    /const applyButtonState = isMatchCountLoading\s*\?\s*"loading"\s*:\s*matchCountUnavailable\s*\?\s*"unavailable"\s*:\s*"ready"/,
  );
  assert.match(
    filterOptionsSource,
    /isLoadingMatches \|\| !profile \|\| loadedProfileId !== profile\.id/,
  );
  assert.match(
    filterOptionsSource,
    /applyButtonState === "loading" \? \([\s\S]*<a[\s\S]*aria-busy="true"[\s\S]*<svg[\s\S]*filter-apply-spinner-indicator[\s\S]*\) : \([\s\S]*<a/,
  );
  assert.equal(
    filterOptionsSource.match(/key=\{applyButtonKey\}/g)?.length,
    2,
  );
  assert.doesNotMatch(filterOptionsSource, /key=\{applyButtonLabel\}/);
  assert.doesNotMatch(filterOptionsSource, /filter-apply-placeholder/);
  assert.doesNotMatch(
    filterOptionsSource,
    /isLoadingMatches \|\| matchCountUnavailable\s*\?\s*"View Climbs"/,
  );
  assert.match(
    filterOptionsSource,
    /setRockoApprovedOnly\(DEFAULT_CLIMB_FILTERS\.rockoApprovedOnly\)/,
  );
  assert.match(
    filterOptionsSource,
    /setShowOutdated\(DEFAULT_CLIMB_FILTERS\.showOutdated\)/,
  );

  const filterStyles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const filterSectionRule =
    filterStyles.match(/\.filter-section\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(filterSectionRule, /gap:\s*0\.875rem/);
  const rockoApprovedLabelRule =
    filterStyles.match(/\.filter-rocko-approved-label\s*\{([^}]*)\}/)?.[1] ??
    "";
  assert.match(rockoApprovedLabelRule, /align-items:\s*center/);
  assert.match(rockoApprovedLabelRule, /gap:\s*0\.5rem/);
  const rockoApprovedFilterIconRule =
    filterStyles.match(/\.rocko-approved-filter-icon\s*\{([^}]*)\}/)?.[1] ??
    "";
  assert.match(rockoApprovedFilterIconRule, /align-self:\s*center/);
  assert.doesNotMatch(
    filterStyles,
    /\.filter-order-choices\s*\{[^}]*border(?:-top)?\s*:/s,
  );
  assert.doesNotMatch(
    filterStyles,
    /\.filter-radio-choice\s*\{[^}]*border(?:-bottom)?\s*:/s,
  );
  const filterToolbarRule =
    filterStyles.match(/\.set-toolbar\.filter-toolbar\s*\{([^}]*)\}/)?.[1] ??
    "";
  assert.match(filterToolbarRule, /position:\s*relative/);
  assert.match(filterToolbarRule, /bottom:\s*auto/);
  assert.match(filterToolbarRule, /background:\s*#ffffff/);
  assert.match(filterToolbarRule, /-webkit-backdrop-filter:\s*none/);
  assert.match(filterToolbarRule, /backdrop-filter:\s*none/);
  const filterPageRule =
    filterStyles.match(/\.filter-page\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(filterPageRule, /display:\s*flex/);
  assert.match(filterPageRule, /height:\s*100dvh/);
  assert.match(filterPageRule, /overflow:\s*hidden/);
  const filterScrollRegionRule =
    filterStyles.match(/\.filter-scroll-region\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(filterScrollRegionRule, /flex:\s*1 1 auto/);
  assert.match(filterScrollRegionRule, /overflow-y:\s*auto/);
  const filterApplyButtonRule =
    filterStyles.match(
      /\.compact-primary-button\.filter-apply-button\s*\{([^}]*)\}/,
    )?.[1] ?? "";
  assert.match(filterApplyButtonRule, /width:\s*auto/);
  assert.match(filterApplyButtonRule, /min-width:\s*7rem/);
  assert.match(filterApplyButtonRule, /min-inline-size:\s*7rem/);
  assert.match(filterApplyButtonRule, /flex:\s*0 0 auto/);
  assert.match(filterApplyButtonRule, /overflow:\s*visible/);
  assert.match(filterApplyButtonRule, /white-space:\s*nowrap/);
  const filterSpinnerIndicatorRule =
    filterStyles.match(
      /\.filter-apply-spinner-indicator\s*\{(?=[^}]*stroke-dasharray)([^}]*)\}/,
    )?.[1] ?? "";
  assert.match(filterSpinnerIndicatorRule, /stroke-dasharray:\s*24 76/);
  assert.match(
    filterSpinnerIndicatorRule,
    /animation:\s*filter-apply-spinner-dash 800ms linear infinite/,
  );
  assert.doesNotMatch(filterSpinnerIndicatorRule, /transform/);
  assert.match(
    filterStyles,
    /@keyframes filter-apply-spinner-dash\s*\{[\s\S]*stroke-dashoffset:\s*-100/,
  );
  assert.match(
    filterStyles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.filter-apply-spinner-indicator\s*\{\s*animation:\s*none/,
  );

  response = await render("/climbs/filter/holds?hold=preset-one");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /<h1 id="hold-filter-heading">Choose holds<\/h1>/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.match(html, /Loading hold spots/);
  assert.match(html, />Done<\/a>/);
});

test("normalizes, serializes, and combines climb filters", () => {
  const filters = parseClimbFilters(
    new URLSearchParams(
      "min=11&max=3&author=Sam&author=Alex&author=alex&hold=hold-b&hold=hold-a&hold=bad%20hold&sent=hide&outdated=show&stars=4&rocko=approved&order=ascents",
    ),
  );
  assert.deepEqual(filters, {
    minGrade: 3,
    maxGrade: 11,
    authors: ["Alex", "Sam"],
    holdIds: ["hold-a", "hold-b"],
    hideSent: true,
    showOutdated: true,
    minStars: 4,
    rockoApprovedOnly: true,
    order: "ascents",
  });
  assert.equal(activeClimbFilterCount(filters), 8);
  assert.equal(hasClimbFilterConstraints(filters), true);
  assert.equal(
    serializeClimbFilters(filters),
    "min=3&max=11&author=Alex&author=Sam&hold=hold-a&hold=hold-b&sent=hide&outdated=show&stars=4&rocko=approved&order=ascents",
  );
  assert.equal(
    buildFilteredHref("/climbs/saved", filters, { id: "route 1" }),
    "/climbs/saved?min=3&max=11&author=Alex&author=Sam&hold=hold-a&hold=hold-b&sent=hide&outdated=show&stars=4&rocko=approved&order=ascents&id=route+1",
  );

  const candidates = [
    {
      name: "Lower bound",
      grade: "V3",
      rockoApproved: true,
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Author alternative",
      grade: "V5",
      rockoApproved: true,
      setter: "sAm",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Upper bound",
      grade: "V11",
      rockoApproved: true,
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Missing hold",
      grade: "V5",
      rockoApproved: true,
      setter: "Alex",
      holds: [{ holdId: "hold-a" }],
    },
    {
      name: "Coordinate only",
      grade: "V5",
      rockoApproved: true,
      setter: "Alex",
      holds: [{ x: 25, y: 40 }],
    },
    {
      name: "Out of range",
      grade: "V12",
      rockoApproved: true,
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Not approved",
      grade: "V5",
      rockoApproved: false,
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
  ];

  const structuralFilters = {
    ...filters,
    hideSent: false,
    minStars: 0,
    order: "newest",
  };
  assert.deepEqual(
    filterClimbs(candidates, structuralFilters).map((climb) => climb.name),
    ["Lower bound", "Author alternative", "Upper bound"],
  );
  assert.equal(matchesClimbFilters(candidates[4], filters), false);
  assert.equal(matchesClimbFilters(candidates[6], filters), false);
  const outdatedClimb = { ...candidates[0], name: "Outdated", outdated: true };
  const defaultFilters = parseClimbFilters(new URLSearchParams());
  assert.equal(matchesClimbFilters(outdatedClimb, defaultFilters), false);
  const showOutdated = parseClimbFilters(
    new URLSearchParams("outdated=show"),
  );
  assert.equal(matchesClimbFilters(outdatedClimb, showOutdated), true);
  assert.equal(matchesClimbFilters(candidates[0], showOutdated), true);
  assert.equal(activeClimbFilterCount(showOutdated), 1);
  assert.equal(hasClimbFilterConstraints(showOutdated), false);
  assert.equal(serializeClimbFilters(showOutdated), "outdated=show");
  assert.deepEqual(
    uniqueFilterAuthors([
      " Zoe ",
      "Alex",
      "zoe",
      "alex",
      "Sam",
      "Alex",
      "sam",
      "Bad\nName",
    ]),
    ["Alex", "Sam", "Zoe"],
  );

  const sentActivity = {
    averageRating: 4.8,
    ratingCount: 7,
    userRating: 5,
  };
  const unsentActivity = {
    averageRating: 4,
    ratingCount: 3,
    userRating: null,
  };
  assert.equal(matchesClimbActivityFilters(sentActivity, filters), false);
  assert.equal(matchesClimbActivityFilters(unsentActivity, filters), true);
  assert.equal(matchesClimbActivityFilters(null, filters), false);

  const ordered = [
    { id: "newest", createdAt: 30, activity: null },
    { id: "popular", createdAt: 10, activity: sentActivity },
    { id: "middle", createdAt: 20, activity: unsentActivity },
  ].sort((left, right) => compareClimbsByOrder(left, right, filters));
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["popular", "middle", "newest"],
  );

  const sortOnly = parseClimbFilters(new URLSearchParams("order=ascents"));
  assert.equal(activeClimbFilterCount(sortOnly), 1);
  assert.equal(hasClimbFilterConstraints(sortOnly), false);
  assert.equal(requiresClimbActivity(sortOnly), true);
  const rockoOnly = parseClimbFilters(
    new URLSearchParams("rocko=approved"),
  );
  assert.equal(activeClimbFilterCount(rockoOnly), 1);
  assert.equal(hasClimbFilterConstraints(rockoOnly), true);
  assert.equal(requiresClimbActivity(rockoOnly), false);
  assert.equal(serializeClimbFilters(rockoOnly), "rocko=approved");
  assert.equal(
    requiresClimbActivity(parseClimbFilters(new URLSearchParams())),
    false,
  );
  assert.deepEqual(
    parseClimbFilters(new URLSearchParams("stars=bad&rocko=true")),
    {
      minGrade: 0,
      maxGrade: 17,
      authors: [],
      holdIds: [],
      hideSent: false,
      showOutdated: false,
      minStars: 0,
      rockoApprovedOnly: false,
      order: "newest",
    },
  );
});

test("finds adjacent climbs in the active filtered order", () => {
  const visibleActivity = {
    averageRating: 4.5,
    ratingCount: 3,
    userRating: null,
  };
  const candidates = [
    {
      id: "newest",
      createdAt: 30,
      grade: "V5",
      rockoApproved: true,
      setter: "Alex",
      holds: [],
      activity: visibleActivity,
    },
    {
      id: "middle",
      createdAt: 20,
      grade: "V6",
      rockoApproved: false,
      setter: "Sam",
      holds: [],
      activity: visibleActivity,
    },
    {
      id: "oldest",
      createdAt: 10,
      grade: "V7",
      rockoApproved: true,
      setter: "Alex",
      holds: [],
      activity: visibleActivity,
    },
  ];
  const allClimbs = parseClimbFilters(new URLSearchParams());
  assert.deepEqual(adjacentClimbIds(candidates, "middle", allClimbs), {
    previousId: "newest",
    nextId: "oldest",
  });

  const alexOnly = parseClimbFilters(new URLSearchParams("author=Alex"));
  assert.deepEqual(adjacentClimbIds(candidates, "middle", alexOnly), {
    previousId: null,
    nextId: null,
  });
  assert.deepEqual(adjacentClimbIds(candidates, "newest", alexOnly), {
    previousId: null,
    nextId: "oldest",
  });
  assert.deepEqual(adjacentClimbIds(candidates, "missing", allClimbs), {
    previousId: null,
    nextId: null,
  });
  assert.deepEqual(
    selectVisibleClimbs(candidates, alexOnly).map((climb) => climb.id),
    ["newest", "oldest"],
  );

  const rockoOnly = parseClimbFilters(
    new URLSearchParams("rocko=approved"),
  );
  assert.deepEqual(
    selectVisibleClimbs(candidates, rockoOnly).map((climb) => climb.id),
    ["newest", "oldest"],
  );
  assert.deepEqual(adjacentClimbIds(candidates, "middle", rockoOnly), {
    previousId: null,
    nextId: null,
  });
});

test("remembers the exact climb order for swipe navigation", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const profileId = "profile-1";
  const filters = serializeClimbFilters(
    parseClimbFilters(
      new URLSearchParams(
        "min=2&max=9&author=Alex&hold=hold-7&sent=hide&stars=3&rocko=approved&order=ascents",
      ),
    ),
  );
  const entries = [
    { climbKind: "saved", climbId: "newest" },
    { climbKind: "saved", climbId: "local-only" },
    { climbKind: "saved", climbId: "oldest" },
  ];

  assert.equal(
    writeClimbNavigationSnapshot(
      storage,
      profileId,
      filters,
      entries,
      1_000,
    ),
    true,
  );
  const snapshot = readClimbNavigationSnapshot(
    storage,
    profileId,
    filters,
    1_500,
  );
  assert.ok(snapshot);
  assert.deepEqual(
    adjacentClimbReferences(snapshot, entries[1]),
    { previous: entries[0], next: entries[2] },
  );
  assert.deepEqual(
    adjacentClimbReferencesInOrder(entries, entries[1]),
    { previous: entries[0], next: entries[2] },
  );
  assert.deepEqual(
    adjacentClimbReferences(snapshot, entries[0]),
    { previous: null, next: entries[1] },
  );
  assert.deepEqual(
    adjacentClimbReferences(snapshot, entries[2]),
    { previous: entries[1], next: null },
  );
  assert.equal(
    adjacentClimbReferences(snapshot, {
      climbKind: "saved",
      climbId: "not-in-list",
    }),
    null,
  );
  assert.equal(
    readClimbNavigationSnapshot(storage, profileId, "", 1_500),
    null,
  );
  assert.equal(
    readClimbNavigationSnapshot(storage, "another-profile", filters, 1_500),
    null,
  );

  clearClimbNavigationSnapshot(storage);
  assert.equal(storage.getItem(CLIMB_NAVIGATION_SNAPSHOT_KEY), null);
});

test("rejects stale, malformed, or unavailable climb navigation snapshots", () => {
  const duplicateEntries = [
    { climbKind: "saved", climbId: "same" },
    { climbKind: "saved", climbId: "same" },
  ];
  const writable = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  assert.equal(
    writeClimbNavigationSnapshot(
      writable,
      "profile-1",
      "",
      duplicateEntries,
      1_000,
    ),
    false,
  );
  assert.equal(
    parseClimbNavigationSnapshot("not-json", "profile-1", "", 1_500),
    null,
  );
  assert.equal(
    parseClimbNavigationSnapshot(
      JSON.stringify({
        version: 1,
        profileId: "profile-1",
        filters: "",
        entries: [{ climbKind: "saved", climbId: "one" }],
        savedAt: 1_000,
      }),
      "profile-1",
      "",
      7 * 60 * 60 * 1_000,
    ),
    null,
  );

  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(
    readClimbNavigationSnapshot(blocked, "profile-1", "", 1_500),
    null,
  );
  assert.equal(
    writeClimbNavigationSnapshot(
      blocked,
      "profile-1",
      "",
      [{ climbKind: "saved", climbId: "one" }],
      1_000,
    ),
    false,
  );
  assert.doesNotThrow(() => clearClimbNavigationSnapshot(blocked));

  const blockedHost = {};
  Object.defineProperty(blockedHost, "sessionStorage", {
    get() {
      throw new Error("blocked");
    },
  });
  assert.equal(
    readSessionClimbNavigationSnapshot(
      blockedHost,
      "profile-1",
      "",
      1_500,
    ),
    null,
  );
  assert.equal(
    writeSessionClimbNavigationSnapshot(
      blockedHost,
      "profile-1",
      "",
      [{ climbKind: "saved", climbId: "one" }],
      1_000,
    ),
    false,
  );
  assert.doesNotThrow(() => clearSessionClimbNavigationSnapshot(blockedHost));
});

test("recognizes deliberate horizontal touch swipes", () => {
  const start = { x: 200, y: 200, time: 100 };
  assert.equal(
    updateSwipeIntent("pending", start, { x: 205, y: 207, time: 120 }),
    "pending",
  );
  assert.equal(
    updateSwipeIntent("pending", start, { x: 205, y: 230, time: 140 }),
    "vertical",
  );
  assert.equal(
    updateSwipeIntent("pending", start, { x: 230, y: 205, time: 140 }),
    "horizontal",
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 300, y: 200, time: 100 },
      { x: 200, y: 215, time: 450 },
      390,
    ),
    "next",
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 100, y: 200, time: 100 },
      { x: 190, y: 180, time: 500 },
      390,
    ),
    "previous",
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 200, y: 200, time: 100 },
      { x: 240, y: 200, time: 300 },
      390,
    ),
    null,
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 200, y: 100, time: 100 },
      { x: 280, y: 250, time: 400 },
      390,
    ),
    null,
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 20, y: 200, time: 100 },
      { x: 120, y: 200, time: 400 },
      390,
    ),
    null,
  );
  assert.equal(
    horizontalSwipeDirection(
      { x: 200, y: 200, time: 100 },
      { x: 100, y: 200, time: 1_200 },
      390,
    ),
    null,
  );
});

test("distinguishes an empty wall from an empty filtered result", () => {
  assert.equal(
    getClimbListState({
      hasActiveFilters: false,
      isLoading: true,
      totalClimbs: 0,
      visibleClimbs: 0,
    }),
    "loading",
  );
  assert.equal(
    getClimbListState({
      hasActiveFilters: false,
      isLoading: false,
      totalClimbs: 0,
      visibleClimbs: 0,
    }),
    "empty",
  );
  assert.equal(
    getClimbListState({
      hasActiveFilters: true,
      isLoading: false,
      totalClimbs: 3,
      visibleClimbs: 0,
    }),
    "filtered-empty",
  );
  assert.equal(
    getClimbListState({
      hasActiveFilters: false,
      isLoading: false,
      totalClimbs: 3,
      visibleClimbs: 3,
    }),
    "ready",
  );
});

test("validates and formats collision-safe climb activity", () => {
  assert.deepEqual(
    DEMO_CLIMB_IDS,
    demoClimbs.map((climb) => climb.slug),
  );
  assert.deepEqual(DEMO_CLIMB_IDS, []);
  assert.equal(
    isClimbReference({ climbKind: "demo", climbId: "first-light" }),
    false,
  );
  assert.equal(
    isClimbReference({ climbKind: "demo", climbId: "not-a-demo" }),
    false,
  );
  assert.notEqual(
    climbActivityKey({ climbKind: "saved", climbId: "first-light" }),
    climbActivityKey({ climbKind: "saved", climbId: "first-light:copy" }),
  );

  const payload = {
    activities: [
      {
        climbKind: "saved",
        climbId: "first-light",
        averageRating: 4.5,
        ratingCount: 2,
        userRating: 5,
      },
    ],
  };
  const activities = parseClimbActivitiesPayload(payload);
  assert.deepEqual(activities, payload.activities);
  assert.deepEqual(
    findClimbActivity(activities, {
      climbKind: "saved",
      climbId: "first-light",
    }),
    payload.activities[0],
  );
  assert.equal(formatAverageRating(5), "5");
  assert.equal(formatAverageRating(4.5), "4.5");
  assert.equal(
    parseClimbActivitiesPayload({
      activities: [{ ...payload.activities[0], ratingCount: 0 }],
    }),
    null,
  );
  assert.equal(
    parseClimbActivitiesPayload({
      activities: [{ ...payload.activities[0], climbKind: "demo" }],
    }),
    null,
  );

  const reference = { climbKind: "saved", climbId: "first-light" };
  const detailPayload = {
    ...payload,
    logbookEntries: [
      { profileName: "Zoë", grade: "V5", rating: 5 },
      { profileName: "Alex", grade: "V4", rating: 4 },
    ],
    userGrade: "V4",
  };
  assert.deepEqual(
    parseClimbActivityDetailPayload(detailPayload, reference),
    {
      activity: payload.activities[0],
      logbookEntries: detailPayload.logbookEntries,
      userGrade: "V4",
    },
  );
  assert.deepEqual(
    parseClimbActivityDetailPayload(
      { activities: [], logbookEntries: [], userGrade: null },
      reference,
    ),
    { activity: null, logbookEntries: [], userGrade: null },
  );
  const detailWithLegacyGrade = {
    ...detailPayload,
    logbookEntries: [
      { ...detailPayload.logbookEntries[0], grade: null },
      detailPayload.logbookEntries[1],
    ],
  };
  assert.deepEqual(
    parseClimbActivityDetailPayload(detailWithLegacyGrade, reference),
    {
      activity: payload.activities[0],
      logbookEntries: detailWithLegacyGrade.logbookEntries,
      userGrade: "V4",
    },
  );
  assert.equal(
    parseClimbActivityDetailPayload(
      { activities: [], logbookEntries: [] },
      reference,
    ),
    null,
  );
  for (const userGrade of ["V18", " V4", 4, undefined]) {
    assert.equal(
      parseClimbActivityDetailPayload(
        { ...detailPayload, userGrade },
        reference,
      ),
      null,
    );
  }
  for (const grade of ["V18", " V4", "v4", 4, undefined]) {
    assert.equal(
      parseClimbActivityDetailPayload(
        {
          ...detailPayload,
          logbookEntries: [
            { ...detailPayload.logbookEntries[0], grade },
            detailPayload.logbookEntries[1],
          ],
        },
        reference,
      ),
      null,
    );
  }
  assert.equal(
    parseClimbActivityDetailPayload(
      {
        ...detailPayload,
        activities: [
          { ...payload.activities[0], userRating: null },
        ],
      },
      reference,
    ),
    null,
  );
  assert.equal(
    parseClimbActivityDetailPayload(
      {
        ...detailPayload,
        logbookEntries: [{ profileName: "Alex", grade: "V4", rating: 0 }],
      },
      reference,
    ),
    null,
  );
  assert.equal(
    parseClimbActivityDetailPayload(
      {
        ...detailPayload,
        logbookEntries: [
          { profileName: " Bad name ", grade: "V4", rating: 5 },
        ],
      },
      reference,
    ),
    null,
  );
  assert.equal(
    parseClimbActivityDetailPayload(detailPayload, {
      climbKind: "saved",
      climbId: "another-climb",
    }),
    null,
  );
});

test("renders the climb setter with the wall and selectable holds", async () => {
  const response = await render("/set-climb");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Choose your holds/);
  assert.match(html, /Tap a hold for a blue circle/);
  assert.match(html, /again for a yellow foothold/);
  assert.match(html, /A fifth tap clears it/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.doesNotMatch(html, /href="\/wall-photo"/);
  assert.match(html, /Loading hold spots/);
  assert.match(html, /class="wall-hold-choice-layer"/);
  assert.doesNotMatch(html, /aria-label="Tap the wall to add a hold"/);
  assert.match(html, />Done<\/button>/);

  const source = await readFile(
    new URL("../app/set-climb/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /foot: "Yellow foothold"/);
  assert.match(source, /foot: "make it a yellow foothold"/);
  assert.match(source, /isAdminUser\(profile\)/);
  assert.match(source, /canManageClimb\(profile, savedClimb\.setter\)/);
  assert.match(source, /placeholder="e\.g\. 85 Degrees"/);
  assert.doesNotMatch(source, /placeholder="e\.g\. Corner Pocket"/);
  assert.match(source, /Please enter a name\./);
  assert.match(source, /Please select a grade\./);
  assert.match(source, /<form className="climb-form" noValidate/);
  assert.match(source, /aria-invalid=\{nameError/);
  assert.match(source, /aria-invalid=\{gradeError/);
  assert.doesNotMatch(source, /Yellow foothold hold/);
});

test("offers the complete V0 through V17 grade range", () => {
  assert.deepEqual(CLIMB_GRADES, [
    "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8",
    "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17",
  ]);
  assert.equal(isClimbGrade("V0"), true);
  assert.equal(isClimbGrade("V17"), true);
  assert.equal(isClimbGrade("V18"), false);
});

test("omits setup step counters from wall setup and climb setting", async () => {
  for (const relativePath of [
    "../app/wall-photo/page.tsx",
    "../app/wall-holds/page.tsx",
    "../app/set-climb/page.tsx",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Step [12] of 2/);
  }
});

test("reserves the wall photo upload screen for Admin", async () => {
  const response = await render("/wall-photo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1>Admin only<\/h1>/);
  assert.doesNotMatch(html, /type="file"/);

  const source = await readFile(
    new URL("../app/wall-photo/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<h1 id="photo-heading">Upload your wall<\/h1>/);
  assert.match(source, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(source, /ACTIVE_USER_PROFILE_HEADER/);
  assert.match(source, /isAdminUser\(profile\)/);
  assert.doesNotMatch(source, /Restore Test Photo/);
  assert.match(source, /Existing hold spots and climbs will carry over/);
});

test("reserves the preset hold spot editor for Admin", async () => {
  const response = await render("/wall-holds?from=photo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1>Admin only<\/h1>/);
  assert.doesNotMatch(html, />Save Wall<\/button>/);

  const source = await readFile(
    new URL("../app/wall-holds/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<h1 id="wall-holds-heading">Mark every hold<\/h1>/);
  assert.match(source, /aria-label="Tap the wall to add a preset hold spot"/);
  assert.match(source, /saveWallHolds\([\s\S]*profile\.id/);
  assert.match(source, /isAdminUser\(profile\)/);
});

test("resizes selected wall circles with a direct manipulation handle", async () => {
  const source = await readFile(
    new URL("../app/wall-holds/page.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const resizeHandleRule =
    css.match(/\.wall-hold-resize-handle\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(source, /className="wall-hold-resize-handle"/);
  assert.match(source, /role="slider"/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /onPointerCancel=\{finishResize\}/);
  assert.match(source, /calc\(100% - 0\.5rem\)/);
  assert.match(resizeHandleRule, /width:\s*1rem/);
  assert.match(resizeHandleRule, /height:\s*1rem/);
  assert.doesNotMatch(resizeHandleRule, /1\.75rem/);
  assert.doesNotMatch(source, /wall-hold-size-slider/);
  assert.doesNotMatch(source, /id="wall-hold-size"/);

  assert.equal(wallHoldSizeFromHorizontalDrag(7, 7, 350), 11);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, -100, 350), 1);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, 100, 350), 20);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, 100, 0), 7);
});

test("lets Admin delete saved hold spots without deleting climbs", async () => {
  const [editorSource, workerSource, listSource, detailSource] =
    await Promise.all([
      readFile(new URL("../app/wall-holds/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../worker/app-data.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/climbs/climb-list-client.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/climbs/saved/saved-climb-detail.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(editorSource, /Delete this saved hold spot\?/);
  assert.match(editorSource, /marked outdated and hidden by default/);
  assert.match(editorSource, /selectedHoldIsSaved \? "Delete Hold" : "Remove"/);
  assert.doesNotMatch(editorSource, /Wall saved, but/);
  assert.match(editorSource, /reconcileBrowserClimbsAfterWallSave/);
  assert.doesNotMatch(
    workerSource,
    /Saved hold spots cannot be removed/,
  );
  assert.match(workerSource, /outdated:\s*true/);
  assert.match(workerSource, /outdated:\s*false/);
  assert.match(listSource, /className="outdated-tag">Outdated/);
  assert.match(detailSource, /This climb is outdated/);
});

test("preserves browser climbs and marks only unresolved or removed-hold climbs outdated", () => {
  const currentHold = { id: "hold-current", x: 20, y: 30, size: 7 };
  const climbs = [
    {
      id: "current-climb",
      outdated: true,
      holds: [{ holdId: currentHold.id }],
    },
    {
      id: "removed-hold-climb",
      holds: [{ holdId: "hold-removed" }],
    },
    {
      id: "unresolved-legacy-climb",
      holds: [{}],
    },
    {
      id: "migrated-legacy-climb",
      outdated: true,
      holds: [{}],
    },
  ];

  const reconciled = reconcileBrowserClimbsAfterWallSave(
    climbs,
    [currentHold],
    new Set(["unresolved-legacy-climb"]),
  );

  assert.equal(reconciled.length, climbs.length);
  assert.deepEqual(
    reconciled.map((climb) => [climb.id, climb.outdated]),
    [
      ["current-climb", false],
      ["removed-hold-climb", true],
      ["unresolved-legacy-climb", true],
      ["migrated-legacy-climb", false],
    ],
  );
});

test("returns to climbs after wall setup while preserving hold-filter returns", () => {
  assert.equal(
    wallSetupReturnPath("https://example.com/wall-holds"),
    "/climbs",
  );
  assert.equal(
    wallSetupReturnPath(
      "https://example.com/wall-holds?returnTo=%2Fclimbs%2Ffilter%2Fholds%3Fmin%3DV4",
    ),
    "/climbs/filter/holds?min=V4",
  );
  assert.equal(
    wallSetupReturnPath(
      "https://example.com/wall-holds?returnTo=https%3A%2F%2Fevil.example%2Fclimbs%2Ffilter%2Fholds",
    ),
    "/climbs",
  );
  assert.equal(wallSetupReturnPath("not a valid URL"), "/climbs");
});

test("renders the browser-saved climb detail shell", async () => {
  const response = await render("/climbs/saved?id=test-climb");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /href="\/climbs"/i);
  assert.match(html, /Preparing the selected climb/);
  assert.doesNotMatch(html, /Loading climb/i);
});

test("preloads a selected saved climb before rendering its page", async () => {
  const [pageSource, loaderSource, detailSource] = await Promise.all([
    readFile(new URL("../app/climbs/saved/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/climbs/saved/server-climb.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/climbs/saved/saved-climb-detail.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /await loadSavedClimbForPage\(climbId\)/);
  assert.match(pageSource, /initialClimb=\{initialClimb\}/);
  assert.match(loaderSource, /handleAppDataRequest\(/);
  assert.match(loaderSource, /getD1Database\(\)/);
  assert.match(detailSource, /useState<[^>]+>\(\s*initialClimb/);
  assert.doesNotMatch(detailSource, /Loading climb(?:&hellip;|\.\.\.)/i);
});

test("supports in-place swipe navigation without pager buttons", async () => {
  const [detailSource, css] = await Promise.all([
    readFile(
      new URL("../app/climbs/saved/saved-climb-detail.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detailSource, /onTouchStart=\{startSwipe\}/);
  assert.match(detailSource, /onTouchMove=\{moveSwipe\}/);
  assert.match(detailSource, /onPointerDown=\{startMouseSwipe\}/);
  assert.match(detailSource, /window\.visualViewport\?\.scale/);
  assert.doesNotMatch(detailSource, /climb-pager/);
  assert.doesNotMatch(detailSource, /Previous climb/);
  assert.doesNotMatch(detailSource, /Next climb/);
  assert.match(detailSource, /ensureClimbCached/);
  assert.match(detailSource, /loadSyncedClimbs/);
  assert.match(detailSource, /removeUnavailableClimbFromNavigation/);
  // In-place browsing deliberately replaces the detail URL. Raw push entries
  // would make Vinext's router restore the route and remount the wall on Back.
  assert.match(detailSource, /window\.history\.replaceState/);
  assert.doesNotMatch(detailSource, /window\.history\.pushState/);
  assert.doesNotMatch(detailSource, /addEventListener\("popstate"/);
  assert.match(detailSource, /setClimb\(nextClimb\)/);
  assert.match(detailSource, /key=\{climb\.id\}/);
  assert.match(detailSource, /window\.location\.assign\(target\.href\)/);
  assert.equal((detailSource.match(/<WallPhoto\b/g) ?? []).length, 1);
  assert.doesNotMatch(detailSource, /setClimb\(undefined\)/);
  assert.doesNotMatch(css, /\.climb-pager(?:-link)?\b/);
  assert.doesNotMatch(
    css,
    /\.wall-map--route\s*\{[^}]*touch-action:\s*none/,
  );
});

test("limits the climb options menu to the setter and Admin", async () => {
  const source = await readFile(
    new URL("../app/climbs/saved/saved-climb-detail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /aria-label="Climb options"/);
  assert.match(source, />\s*Edit climb\s*</);
  assert.match(source, /Delete climb/);
  assert.match(source, /buildFilteredHref\("\/set-climb"/);
  assert.match(source, /aria-busy=\{isLeaving/);
  assert.match(source, /Loading climbs&hellip;/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /canManageClimb\(profile, climb\.setter\)/);
  assert.match(source, /canManage \? \(/);
  assert.match(source, /const canChangeApproval = isAdminUser\(profile\)/);
  assert.match(source, /Give Rocko's Approval/);
  assert.match(source, /Remove Rocko's Approval/);
  assert.match(source, /setRockoApproval\(/);
  assert.match(source, /deleteClimb\(climbToDelete\.id, profile\.id\)/);
  assert.doesNotMatch(source, /className="climb-detail-actions"/);
  assert.doesNotMatch(source, /className="delete-climb-button"/);
});

test("shows Rocko approval on climb lists and in the requested detail rows", async () => {
  const [listSource, savedDetailSource, demoDetailSource, css] =
    await Promise.all([
      readFile(
        new URL("../app/climbs/climb-list-client.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/climbs/saved/saved-climb-detail.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/climbs/[slug]/page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

  assert.match(listSource, /climb\.rockoApproved \? \(/);
  assert.match(listSource, /aria-label="Rocko Approved"/);
  assert.match(listSource, /className="rocko-approved-icon"/);
  assert.match(savedDetailSource, /className="rocko-approved-tag"/);
  assert.match(savedDetailSource, />Rocko Approved</);
  for (const source of [savedDetailSource, demoDetailSource]) {
    assert.match(source, /className="detail-title-line"/);
    assert.match(source, /className="detail-grade"/);
    assert.match(source, /className="detail-meta-line"/);
  }
  const iconRule = css.match(/\.rocko-approved-icon\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(iconRule, /background:\s*transparent[^;]*\/rocko-approved\.png/);
  assert.doesNotMatch(iconRule, /border(?:-radius)?:|box-shadow:/);
  const tagRule = css.match(/\.rocko-approved-tag\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(tagRule, /border:\s*1px\s+solid\s+#d99f00/i);
  assert.match(tagRule, /background:\s*rgba\(250,\s*187,\s*0,\s*0\.12\)/i);
  assert.match(tagRule, /color:\s*#d99f00/i);
  assert.match(tagRule, /white-space:\s*nowrap/);
});

test("shows a responsive climb logbook below the send action", async () => {
  const [panelSource, sendApiSource, css] = await Promise.all([
    readFile(
      new URL("../app/climbs/climb-activity-panel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/climbs/send-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    panelSource,
    /<p className="climb-section-label">Community rating<\/p>/,
  );
  assert.match(
    panelSource,
    /<h2 className="climb-section-label" id="climb-logbook-heading">/,
  );
  assert.match(panelSource, /Loading logbook&hellip;/);
  assert.match(panelSource, /Logbook unavailable\./);
  assert.match(panelSource, /No sends yet\./);
  assert.match(panelSource, /className="climb-logbook-list"/);
  assert.match(panelSource, /aria-label=\{`\$\{entry\.rating\} out of 5 stars`\}/);
  assert.match(panelSource, /Array\.from\(\{ length: entry\.rating \}/);
  assert.doesNotMatch(panelSource, /\{entry\.rating\}\/5/);
  assert.match(panelSource, /className="climb-logbook-details"/);
  assert.match(panelSource, /className="climb-logbook-grade"/);
  assert.match(panelSource, /className="climb-logbook-rating"\s+role="img"/);
  assert.match(panelSource, /Grade not recorded/);
  assert.match(panelSource, /entry\.grade \?\? "—"/);
  assert.ok(
    panelSource.indexOf('className="climb-logbook-rating"') <
      panelSource.indexOf('className="climb-logbook-grade"'),
  );
  assert.ok(
    panelSource.indexOf('className="primary-button sent-button"') <
      panelSource.indexOf('className="climb-logbook"'),
  );
  assert.match(panelSource, /loadClimbActivityDetail\(/);
  assert.match(panelSource, /referenceKey/);
  assert.match(
    panelSource,
    /\[climbId, climbKind, profile, referenceKey\]/,
  );
  assert.match(panelSource, /controller\.abort\(\)/);
  assert.doesNotMatch(panelSource, /dangerouslySetInnerHTML/);
  assert.match(sendApiSource, /climbKind:\s*reference\.climbKind/);
  assert.match(sendApiSource, /climbId:\s*reference\.climbId/);

  const entryRule =
    css.match(/\.climb-logbook-entry\s*\{([^}]*)\}/)?.[1] ?? "";
  const nameRule =
    css.match(/\.climb-logbook-name\s*\{([^}]*)\}/)?.[1] ?? "";
  const ratingRule =
    css.match(/\.climb-logbook-rating\s*\{([^}]*)\}/)?.[1] ?? "";
  const detailsRule =
    css.match(/\.climb-logbook-details\s*\{([^}]*)\}/)?.[1] ?? "";
  const gradeRule =
    css.match(/\.climb-logbook-grade\s*\{([^}]*)\}/)?.[1] ?? "";
  const sectionLabelRule =
    css.match(/\.climb-section-label\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(sectionLabelRule, /font-size:\s*0\.75rem/);
  assert.match(sectionLabelRule, /font-weight:\s*650/);
  assert.match(entryRule, /display:\s*grid/);
  assert.match(entryRule, /min-width:\s*0/);
  assert.match(
    entryRule,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/,
  );
  assert.doesNotMatch(entryRule, /padding(?:-block)?:/);
  assert.doesNotMatch(entryRule, /border-top:/);
  assert.match(nameRule, /min-width:\s*0/);
  assert.match(nameRule, /overflow-wrap:\s*anywhere/);
  assert.match(detailsRule, /display:\s*inline-flex/);
  assert.match(detailsRule, /justify-content:\s*flex-end/);
  assert.match(detailsRule, /white-space:\s*nowrap/);
  assert.match(ratingRule, /display:\s*inline-flex/);
  assert.match(ratingRule, /flex:\s*0\s+0\s+auto/);
  assert.match(ratingRule, /gap:\s*0\.12rem/);
  assert.match(ratingRule, /white-space:\s*nowrap/);
  assert.match(gradeRule, /flex:\s*0\s+0\s+auto/);
  assert.match(gradeRule, /text-align:\s*right/);
  assert.match(gradeRule, /white-space:\s*nowrap/);
});

test("allows long climb names to wrap without entering the grade column", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const rowRule = css.match(/\.climb-row\s*\{([^}]*)\}/)?.[1] ?? "";
  const nameRule =
    css.match(/\.climb-name-text\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(rowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(nameRule, /flex:\s*1\s+1\s+auto/);
  assert.match(nameRule, /overflow-wrap:\s*anywhere/);
  assert.match(nameRule, /white-space:\s*normal/);
  assert.doesNotMatch(nameRule, /text-overflow:\s*ellipsis/);
});

test("omits the visible color key from climb details", async () => {
  for (const relativePath of [
    "../app/climbs/saved/saved-climb-detail.tsx",
    "../app/climbs/[slug]/page.tsx",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /hold-legend|legend-dot|Hold marker legend/);
    assert.match(source, /<figcaption className="sr-only">/);
  }

  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /\.hold-legend|\.legend-dot/);
});

test("retires every prototype climb and rating route", async () => {
  for (const slug of [
    "first-light",
    "barn-door-protocol",
    "quiet-feet",
    "static-bloom",
    "redline",
  ]) {
    let response = await render(`/climbs/${slug}`);
    assert.equal(response.status, 404);

    response = await render(`/climbs/sent?kind=demo&id=${slug}`);
    assert.equal(response.status, 404);
  }
});

test("renders the saved-climb send shell and preserves filters", async () => {
  const response = await render(
    "/climbs/sent?kind=saved&id=test-climb&min=2&max=6&author=Sheafy&sent=hide&stars=4&order=ascents",
  );
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Loading climb/);
  assert.match(
    html,
    /href="\/climbs\/saved\?min=2&amp;max=6&amp;author=Sheafy&amp;sent=hide&amp;stars=4&amp;order=ascents&amp;id=test-climb"/,
  );

  const notFoundResponse = await render(
    "/climbs/sent?kind=demo&id=first-light",
  );
  assert.equal(notFoundResponse.status, 404);
});

test("logs a send with a grade selector before the star rating", async () => {
  const [
    panelSource,
    sentSource,
    sendApiSource,
    setterSource,
    climbApiSource,
    css,
  ] = await Promise.all([
      readFile(
        new URL("../app/climbs/climb-activity-panel.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/climbs/sent/sent-climb-client.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/climbs/send-api.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/set-climb/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/climbs/climb-api.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

  assert.match(panelSource, /"Edit Send"\s*:\s*"Log Send"/);
  assert.doesNotMatch(panelSource, /"Edit Rating"\s*:\s*"Sent"/);
  assert.match(sentSource, /loadClimbActivityDetail\(/);
  assert.match(sentSource, /existingGrade \?\? loadedClimb\?\.grade \?\? ""/);
  assert.match(sentSource, /What grade would you give this climb\?/);
  assert.match(
    sentSource,
    /<h1 id="sent-heading">\{climb\.name\}<\/h1>/,
  );
  assert.doesNotMatch(
    sentSource,
    /Log your climb|Log your send|Choose a rating from 1 to 5\./,
  );
  assert.doesNotMatch(sentSource, />\s*\{climb\.grade\}\s*</);
  assert.doesNotMatch(sentSource, /aria-label=\{`Consensus grade/);
  assert.match(sentSource, /name="grade"/);
  assert.match(sentSource, /className="sent-grade-select"/);
  assert.match(sentSource, /<option disabled value="">/);
  assert.match(sentSource, /CLIMB_GRADES\.map/);
  assert.ok(
    sentSource.indexOf('<h1 id="sent-heading">') <
      sentSource.indexOf('id="send-grade-select"'),
  );
  assert.ok(
    sentSource.indexOf('id="send-grade-select"') <
      sentSource.indexOf("<fieldset"),
  );
  assert.match(
    sentSource,
    /<legend>How many stars would you give this climb\?<\/legend>/,
  );
  assert.match(sentSource, /className="star-radio-input"/);
  assert.match(sentSource, /star-rating-label--filled/);
  assert.match(sentSource, /const ratings = \[1, 2, 3, 4, 5\] as const/);
  assert.match(sentSource, /name="rating"/);
  assert.match(sentSource, /type="radio"/);
  assert.match(
    sentSource,
    /saveClimbSend\(\s*reference,\s*profile\.id,\s*displayedGrade,\s*displayedRating/,
  );
  assert.match(sentSource, /"Update Send"/);
  assert.match(sentSource, /"Save Send"/);
  assert.match(
    sentSource,
    /\{existingRating !== null \? \(\s*<button\s+className="secondary-button sent-remove-button"/,
  );
  assert.match(
    sentSource,
    /className="secondary-button sent-remove-button"[\s\S]*?type="button"[\s\S]*?"Remove Send"/,
  );
  assert.match(sentSource, /removeClimbSend\(reference, profile\.id\)/);
  assert.match(
    sentSource,
    /Remove your send for “\$\{climb\.name\}”\? This removes your grade and rating from the logbook\./,
  );
  assert.ok(
    sentSource.indexOf('"Update Send"') <
      sentSource.indexOf('"Remove Send"'),
  );
  assert.equal(
    (sentSource.match(/clearSessionClimbNavigationSnapshot\(window\)/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (sentSource.match(/window\.location\.replace\(backHref\)/g) ?? []).length,
    2,
  );
  assert.match(sendApiSource, /profileId, grade, rating/);
  assert.match(sendApiSource, /profileId,\s*grade,\s*rating/);
  assert.match(sendApiSource, /export async function removeClimbSend/);
  assert.match(
    sendApiSource,
    /method:\s*"DELETE"[\s\S]*?JSON\.stringify\(\{ \.\.\.reference, profileId \}\)/,
  );
  assert.match(sendApiSource, /Your send could not be removed\./);
  assert.match(setterSource, /savedClimb\.setterGrade \?\? savedClimb\.grade/);
  assert.match(setterSource, /clearSessionClimbNavigationSnapshot\(window\)/);
  assert.equal(
    (climbApiSource.match(/climb\.setterGrade \?\? climb\.grade/g) ?? [])
      .length,
    2,
  );

  const gradeControlRule =
    css.match(/\.sent-grade-control\s*\{([^}]*)\}/)?.[1] ?? "";
  const gradeSelectRule =
    css.match(/\.sent-grade-control select\s*\{([^}]*)\}/)?.[1] ?? "";
  const gradeArrowRule =
    css.match(/\.sent-grade-select::after\s*\{([^}]*)\}/)?.[1] ?? "";
  const climbNameRule =
    css.match(/\.sent-climb-heading h1\s*\{([^}]*)\}/)?.[1] ?? "";
  const removeButtonRule =
    css.match(/\.secondary-button\.sent-remove-button\s*\{([^}]*)\}/)?.[1] ??
    "";
  assert.match(gradeControlRule, /display:\s*flex/);
  assert.match(gradeSelectRule, /width:\s*100%/);
  assert.match(gradeSelectRule, /min-height:\s*3\.5rem/);
  assert.match(gradeSelectRule, /(?:^|\n)\s*appearance:\s*none/);
  assert.match(gradeSelectRule, /padding:\s*0\.8rem\s+3rem/);
  assert.match(gradeArrowRule, /right:\s*1\.2rem/);
  assert.match(gradeArrowRule, /pointer-events:\s*none/);
  assert.match(climbNameRule, /font-size:\s*clamp\(2rem,\s*8vw,\s*2\.75rem\)/);
  assert.match(climbNameRule, /overflow-wrap:\s*anywhere/);
  assert.match(removeButtonRule, /width:\s*100%/);
  assert.match(removeButtonRule, /border-color:\s*#b42331/i);
  assert.match(removeButtonRule, /background:\s*#ffffff/i);
  assert.match(removeButtonRule, /color:\s*#b42331/i);
});

test("returns not found for an unknown climb", async () => {
  const response = await render("/climbs/not-a-real-climb");
  assert.equal(response.status, 404);
});

test("uploads, serves, and resets the shared wall photo", async () => {
  const worker = await loadWorker();
  const bucket = createMemoryWallPhotoBucket();
  const database = createMemoryAppDatabase();
  database.seedProfile({
    id: "profile-admin",
    name: "aDmIn",
    createdAt: 1,
  });
  database.seedProfile({
    id: "profile-alex",
    name: "Alex",
    createdAt: 2,
  });
  const environment = createEnvironment({ DB: database, WALL_PHOTOS: bucket });
  const fetchWallPhoto = (request) =>
    worker.fetch(request, environment, createContext());

  let response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo"),
  );
  assert.equal(response.status, 307);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        "Content-Type": "image/svg+xml",
        Origin: "http://localhost",
      },
      body: "<svg />",
    }),
  );
  assert.equal(response.status, 415);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        Origin: "https://example.com",
      },
      body: new Uint8Array([1, 2, 3]),
    }),
  );
  assert.equal(response.status, 403);

  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-alex",
        "Content-Type": "image/png",
        Origin: "http://localhost",
      },
      body: imageBytes,
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        "Content-Type": "image/png",
        Origin: "http://localhost",
      },
      body: imageBytes,
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), String(imageBytes.length));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    imageBytes,
  );

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      headers: { "If-None-Match": '"wall-photo-test"' },
    }),
  );
  assert.equal(response.status, 304);
  assert.equal((await response.arrayBuffer()).byteLength, 0);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "HEAD",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal((await response.arrayBuffer()).byteLength, 0);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "DELETE",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-alex",
        Origin: "http://localhost",
      },
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo"),
  );
  assert.equal(response.status, 200);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "DELETE",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        Origin: "http://localhost",
      },
    }),
  );
  assert.equal(response.status, 204);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo"),
  );
  assert.equal(response.status, 307);
});

test("redirects to the bundled test wall when no photo has been uploaded", async () => {
  const worker = await loadWorker();
  const environment = createEnvironment({
    WALL_PHOTOS: createMemoryWallPhotoBucket(),
  });

  const response = await worker.fetch(
    new Request("http://localhost/api/wall-photo"),
    environment,
    createContext(),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/wall-prototype.png");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects invalid and unsafe wall photo requests", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  database.seedProfile({
    id: "profile-admin",
    name: "Admin",
    createdAt: 1,
  });
  const fetchWallPhoto = (request, environment = createEnvironment({
    DB: database,
    WALL_PHOTOS: createMemoryWallPhotoBucket(),
  })) => worker.fetch(request, environment, createContext());

  let response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        "Content-Type": "image/png",
        Origin: "http://localhost",
      },
      body: new Uint8Array(),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        "Content-Length": String(20 * 1024 * 1024 + 1),
        "Content-Type": "image/png",
        Origin: "http://localhost",
      },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    }),
  );
  assert.equal(response.status, 413);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
        [ACTIVE_USER_PROFILE_HEADER]: "profile-admin",
        "Content-Type": "image/png",
        Origin: "http://localhost",
      },
      body: new Uint8Array([1, 2, 3]),
    }),
  );
  assert.equal(response.status, 415);

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", { method: "PATCH" }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD, POST, DELETE");

  response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", { method: "POST" }),
    createEnvironment(),
  );
  assert.equal(response.status, 503);
});

test("persists preset wall spots and keeps their stable ids", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  database.seedProfile({ id: "profile-admin", name: "Admin", createdAt: 1 });
  database.seedProfile({ id: "profile-alex", name: "Alex", createdAt: 2 });
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  let response = await fetchAppData(
    new Request("http://localhost/api/wall-holds"),
  );
  assert.equal(response.status, 200);
  const emptyHoldMap = await response.json();
  assert.deepEqual(emptyHoldMap.holds, []);
  assert.equal(emptyHoldMap.updatedAt, 0);

  const holds = [
    { id: "stable-hold-a", x: 24.5, y: 82.25, size: 7 },
    { id: "stable-hold-b", x: 71.75, y: 14.5, size: 8 },
  ];
  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds,
        expectedUpdatedAt: 0,
        profileId: "profile-admin",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const savedHoldMap = await response.json();
  assert.deepEqual(savedHoldMap.holds, holds);
  assert.ok(savedHoldMap.updatedAt > 0);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds"),
  );
  assert.deepEqual((await response.json()).holds, holds);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds,
        expectedUpdatedAt: savedHoldMap.updatedAt,
        profileId: "profile-alex",
      }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({
        holds,
        expectedUpdatedAt: savedHoldMap.updatedAt,
        profileId: "profile-admin",
      }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: [holds[0], holds[0]],
        expectedUpdatedAt: savedHoldMap.updatedAt,
        profileId: "profile-admin",
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", { method: "DELETE" }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, PUT");
});

test("creates and reloads password-free user profiles", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  let response = await fetchAppData(
    new Request("http://localhost/api/profiles"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { profiles: [] });

  response = await fetchAppData(
    new Request("http://localhost/api/climbs"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { climbs: [] });
  assert.equal(database.schemaBatchCount(), 1);

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: "  Zoë   O’Connor  " }),
    }),
  );
  assert.equal(response.status, 201);
  const createdProfile = (await response.json()).profile;
  assert.match(createdProfile.id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
  assert.equal(createdProfile.name, "Zoë O’Connor");
  assert.equal(Number.isSafeInteger(createdProfile.createdAt), true);

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: createdProfile.name }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profile, createdProfile);

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: "Sheafy" }),
    }),
  );
  assert.equal(response.status, 201);
  const sheafyProfile = (await response.json()).profile;
  assert.equal(sheafyProfile.name, "Sheafy");

  for (const name of ["sheafy", "shEafy", "SHEAFY"]) {
    response = await fetchAppData(
      new Request("http://localhost/api/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ name }),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).profile, sheafyProfile);
  }

  database.seedProfile({
    id: "sheafy-legacy-alias",
    name: "sHEAFY",
    createdAt: sheafyProfile.createdAt + 1,
  });
  response = await fetchAppData(
    new Request("http://localhost/api/profiles/sheafy-legacy-alias"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profile, sheafyProfile);

  response = await fetchAppData(
    new Request(
      `http://localhost/api/profiles/${encodeURIComponent(createdProfile.id)}`,
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profile, createdProfile);

  for (const name of [
    "   ",
    "You",
    "you",
    "yOu",
    "Bad\nName",
    "x".repeat(51),
  ]) {
    response = await fetchAppData(
      new Request("http://localhost/api/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ name }),
      }),
    );
    assert.equal(response.status, 400);
  }

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alex" }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/profiles/not-found"),
  );
  assert.equal(response.status, 404);

  for (let index = 0; index < 205; index += 1) {
    database.seedProfile({
      id: `aaron-${String(index).padStart(3, "0")}`,
      name: "Aaron",
      createdAt: index + 1,
    });
  }
  database.seedProfile({
    id: "zed-profile",
    name: "Zed",
    createdAt: 500,
  });
  database.seedProfile({
    id: "aaron-case-variant",
    name: "aArOn",
    createdAt: 501,
  });

  response = await fetchAppData(
    new Request("http://localhost/api/profiles"),
  );
  assert.equal(response.status, 200);
  const profiles = (await response.json()).profiles;
  assert.equal(profiles.length, 4);
  assert.deepEqual(
    profiles.map((profile) => profile.name).sort(),
    ["Aaron", "Sheafy", "Zed", createdProfile.name].sort(),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", { method: "DELETE" }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
});

test("logs sends, updates ratings, and calculates per-user averages", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  for (const profile of [
    { id: "profile-alex", name: "Alex", createdAt: 1 },
    { id: "profile-blair", name: "Blair", createdAt: 2 },
    { id: "profile-casey", name: "Casey", createdAt: 3 },
    { id: "profile-alex-two", name: "Alex", createdAt: 4 },
  ]) {
    database.seedProfile(profile);
  }
  database.seedClimb({
    id: "saved-route-one",
    name: "Saved Route One",
    grade: "V4",
    setter: "Alex",
    createdAt: 10,
    holds: [
      { x: 20, y: 80, size: 7, role: "start" },
      { x: 70, y: 10, size: 7, role: "finish" },
    ],
  });
  database.seedClimb({
    id: "saved-route-two",
    name: "Saved Route Two",
    grade: "V6",
    setter: "Blair",
    createdAt: 11,
    holds: [
      { x: 25, y: 85, size: 7, role: "start" },
      { x: 65, y: 15, size: 7, role: "finish" },
    ],
  });

  const send = (body, origin = "http://localhost") =>
    fetchAppData(
      new Request("http://localhost/api/sends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const savedSend = (
    profileId,
    rating,
    climbId = "saved-route-one",
    grade = "V4",
  ) => send({ climbKind: "saved", climbId, profileId, grade, rating });

  let response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=profile-alex"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).activities, []);
  assert.equal(response.headers.get("cache-control"), "no-store");

  response = await savedSend("profile-alex", 1);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).activities, [
    {
      climbKind: "saved",
      climbId: "saved-route-one",
      averageRating: 1,
      ratingCount: 1,
      userRating: 1,
    },
  ]);

  response = await savedSend("profile-blair", 5);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).activities[0], {
    climbKind: "saved",
    climbId: "saved-route-one",
    averageRating: 3,
    ratingCount: 2,
    userRating: 5,
  });

  response = await savedSend("profile-alex", 4);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).activities[0], {
    climbKind: "saved",
    climbId: "saved-route-one",
    averageRating: 4.5,
    ratingCount: 2,
    userRating: 4,
  });
  assert.equal(database.sendCount(), 2);

  response = await fetchAppData(
    new Request(
      "http://localhost/api/sends?profileId=profile-alex&climbKind=saved&climbId=saved-route-one",
    ),
  );
  assert.equal(response.status, 200);
  const updatedLogbook = await response.json();
  assert.deepEqual(
    [...updatedLogbook.logbookEntries].sort((left, right) =>
      left.profileName.localeCompare(right.profileName),
    ),
    [
      { profileName: "Alex", grade: "V4", rating: 4 },
      { profileName: "Blair", grade: "V4", rating: 5 },
    ],
  );
  assert.equal(updatedLogbook.activities[0].userRating, 4);
  assert.equal(updatedLogbook.userGrade, "V4");
  assert.equal(database.sendCount(), 2);

  response = await savedSend("profile-alex", 4, "saved-route-two");
  assert.equal(response.status, 200);
  response = await savedSend("profile-alex-two", 2, "saved-route-two");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).activities[0], {
    climbKind: "saved",
    climbId: "saved-route-two",
    averageRating: 2,
    ratingCount: 1,
    userRating: 2,
  });

  response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=profile-alex-two"),
  );
  const duplicateProfileActivities = (await response.json()).activities;
  assert.equal(
    duplicateProfileActivities.find(
      (activity) =>
        activity.climbKind === "saved" &&
        activity.climbId === "saved-route-two",
    )?.userRating,
    2,
  );

  assert.equal(database.sendCount(), 3);

  response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=profile-casey"),
  );
  assert.equal(response.status, 200);
  const caseyActivities = (await response.json()).activities;
  assert.equal(caseyActivities.length, 2);
  assert.equal(
    caseyActivities.every((activity) => activity.userRating === null),
    true,
  );
  assert.equal(
    caseyActivities.some(
      (activity) =>
        activity.climbKind === "saved" &&
        activity.climbId === "saved-route-one",
    ),
    true,
  );
  assert.equal(
    caseyActivities.some(
      (activity) =>
        activity.climbKind === "saved" &&
        activity.climbId === "saved-route-two",
    ),
    true,
  );

  for (const rating of [0, 6, 1.5, "5", null, true]) {
    response = await savedSend("profile-alex", rating);
    assert.equal(response.status, 400);
  }
  for (const grade of [undefined, null, "V18", "V-1", "v4", 4]) {
    response = await send({
      climbKind: "saved",
      climbId: "saved-route-one",
      profileId: "profile-alex",
      grade,
      rating: 3,
    });
    assert.equal(response.status, 400);
  }
  response = await send({
    climbKind: "demo",
    climbId: "first-light",
    profileId: "profile-alex",
    grade: "V4",
    rating: 3,
  });
  assert.equal(response.status, 400);
  response = await send({
    climbKind: "saved",
    climbId: "unknown-saved-climb",
    profileId: "profile-alex",
    grade: "V4",
    rating: 3,
  });
  assert.equal(response.status, 404);
  response = await savedSend("unknown-profile", 3);
  assert.equal(response.status, 400);
  response = await send({
    climbKind: "saved",
    climbId: "saved-route-one",
    profileId: "profile-alex",
    grade: "V4",
    rating: 3,
    averageRating: 5,
  });
  assert.equal(response.status, 400);
  response = await send(
    {
      climbKind: "saved",
      climbId: "saved-route-one",
      profileId: "profile-alex",
      grade: "V4",
      rating: 3,
    },
    "",
  );
  assert.equal(response.status, 403);

  response = await send(
    {
      climbKind: "saved",
      climbId: "saved-route-one",
      profileId: "profile-alex",
      grade: "V4",
      rating: 3,
    },
    "https://example.com",
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/saved-route-one", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ profileId: "profile-alex" }),
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(database.sendCount(), 1);

  response = await fetchAppData(
    new Request(
      "http://localhost/api/sends?profileId=profile-alex&climbKind=saved&climbId=saved-route-one",
    ),
  );
  assert.equal(response.status, 410);

  response = await send({
    climbKind: "saved",
    climbId: "saved-route-one",
    profileId: "profile-alex",
    grade: "V4",
    rating: 4,
  });
  assert.equal(response.status, 410);

  response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=profile-alex"),
  );
  const alexActivities = (await response.json()).activities;
  assert.equal(
    alexActivities.some(
      (activity) =>
        activity.climbKind === "saved" &&
        activity.climbId === "saved-route-one",
    ),
    false,
  );
  assert.equal(
    alexActivities.some(
      (activity) =>
        activity.climbKind === "saved" &&
        activity.climbId === "saved-route-two",
    ),
    true,
  );

  database.seedSend({
    climbKind: "demo",
    climbId: "retired-demo",
    profileId: "profile-alex",
    rating: 3,
    sentAt: 20,
    updatedAt: 20,
  });
  response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=profile-alex"),
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).activities.some(
      (activity) => activity.climbId === "retired-demo",
    ),
    false,
  );

  response = await fetchAppData(
    new Request("http://localhost/api/sends?profileId=missing-profile"),
  );
  assert.equal(response.status, 404);
  response = await fetchAppData(
    new Request("http://localhost/api/sends", { method: "PUT" }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST, DELETE");
});

test("removes only the active user's send and refreshes climb activity", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  for (const profile of [
    { id: "profile-alex", name: "Alex", createdAt: 1 },
    { id: "profile-blair", name: "Blair", createdAt: 2 },
  ]) {
    database.seedProfile(profile);
  }
  for (const climb of [
    {
      id: "remove-send-route",
      name: "Remove Send Route",
      grade: "V4",
      setter: "Alex",
      createdAt: 10,
    },
    {
      id: "remove-send-other-route",
      name: "Other Route",
      grade: "V1",
      setter: "Blair",
      createdAt: 11,
    },
  ]) {
    database.seedClimb({
      ...climb,
      holds: [
        { x: 20, y: 80, size: 7, role: "start" },
        { x: 70, y: 10, size: 7, role: "finish" },
      ],
    });
  }
  for (const send of [
    {
      climbKind: "saved",
      climbId: "remove-send-route",
      profileId: "profile-alex",
      grade: "V2",
      rating: 2,
      sentAt: 20,
      updatedAt: 20,
    },
    {
      climbKind: "saved",
      climbId: "remove-send-route",
      profileId: "profile-blair",
      grade: "V6",
      rating: 5,
      sentAt: 21,
      updatedAt: 21,
    },
    {
      climbKind: "saved",
      climbId: "remove-send-other-route",
      profileId: "profile-alex",
      grade: "V1",
      rating: 4,
      sentAt: 22,
      updatedAt: 22,
    },
  ]) {
    database.seedSend(send);
  }

  const removeSend = (
    body,
    origin = "http://localhost",
    contentType = "application/json",
  ) =>
    fetchAppData(
      new Request("http://localhost/api/sends", {
        method: "DELETE",
        headers: {
          "Content-Type": contentType,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const alexSend = {
    climbKind: "saved",
    climbId: "remove-send-route",
    profileId: "profile-alex",
  };

  let response = await removeSend(alexSend);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  assert.equal(
    database.sendFor("saved", "remove-send-route", "profile-alex"),
    null,
  );
  assert.equal(
    database.sendFor("saved", "remove-send-route", "profile-blair")?.rating,
    5,
  );
  assert.equal(
    database.sendFor(
      "saved",
      "remove-send-other-route",
      "profile-alex",
    )?.rating,
    4,
  );
  assert.equal(database.sendCount(), 2);

  response = await fetchAppData(
    new Request(
      "http://localhost/api/sends?profileId=profile-alex&climbKind=saved&climbId=remove-send-route",
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    activities: [
      {
        climbKind: "saved",
        climbId: "remove-send-route",
        averageRating: 5,
        ratingCount: 1,
        userRating: null,
      },
    ],
    logbookEntries: [{ profileName: "Blair", grade: "V6", rating: 5 }],
    userGrade: null,
  });

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/remove-send-route"),
  );
  let climb = (await response.json()).climb;
  assert.equal(climb.grade, "V6");
  assert.equal(climb.setterGrade, "V4");

  response = await removeSend(alexSend);
  assert.equal(response.status, 204);
  assert.equal(database.sendCount(), 2);

  for (const [body, origin, contentType, expectedStatus] of [
    [{ ...alexSend, rating: 3 }, "http://localhost", "application/json", 400],
    [
      { ...alexSend, profileId: "unknown-profile" },
      "http://localhost",
      "application/json",
      400,
    ],
    [
      { ...alexSend, climbId: "bad id" },
      "http://localhost",
      "application/json",
      400,
    ],
    [alexSend, "", "application/json", 403],
    [alexSend, "https://example.com", "application/json", 403],
    [alexSend, "http://localhost", "text/plain", 415],
  ]) {
    response = await removeSend(body, origin, contentType);
    assert.equal(response.status, expectedStatus);
  }
  assert.equal(database.sendCount(), 2);

  response = await removeSend({
    ...alexSend,
    profileId: "profile-blair",
  });
  assert.equal(response.status, 204);
  assert.equal(database.sendCount(), 1);
  response = await fetchAppData(
    new Request("http://localhost/api/climbs/remove-send-route"),
  );
  climb = (await response.json()).climb;
  assert.equal(climb.grade, "V4");
  assert.equal(climb.setterGrade, "V4");
});

test("uses explicit send grades for the consensus while preserving the setter grade", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  for (const profile of [
    { id: "profile-alex", name: "Alex", createdAt: 1 },
    { id: "profile-blair", name: "Blair", createdAt: 2 },
    { id: "profile-legacy", name: "Legacy", createdAt: 3 },
    { id: "profile-admin", name: "Admin", createdAt: 4 },
  ]) {
    database.seedProfile(profile);
  }
  database.seedClimb({
    id: "consensus-route",
    name: "Consensus Route",
    grade: "V4",
    setter: "Alex",
    createdAt: 10,
    holds: [
      { x: 20, y: 80, size: 7, role: "start" },
      { x: 70, y: 10, size: 7, role: "finish" },
    ],
  });
  database.seedSend({
    climbKind: "saved",
    climbId: "consensus-route",
    profileId: "profile-legacy",
    rating: 3,
    sentAt: 20,
    updatedAt: 20,
  });

  const loadClimb = async () => {
    const response = await fetchAppData(
      new Request("http://localhost/api/climbs/consensus-route"),
    );
    assert.equal(response.status, 200);
    return (await response.json()).climb;
  };
  const saveSend = (profileId, grade, rating) =>
    fetchAppData(
      new Request("http://localhost/api/sends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          climbKind: "saved",
          climbId: "consensus-route",
          profileId,
          grade,
          rating,
        }),
      }),
    );

  let climb = await loadClimb();
  assert.equal(climb.grade, "V4");
  assert.equal(climb.setterGrade, "V4");

  let response = await fetchAppData(
    new Request("http://localhost/api/climbs"),
  );
  assert.equal(response.status, 200);
  let listedClimb = (await response.json()).climbs.find(
    (candidate) => candidate.id === "consensus-route",
  );
  assert.equal(listedClimb.grade, "V4");
  assert.equal(listedClimb.setterGrade, "V4");

  response = await fetchAppData(
    new Request(
      "http://localhost/api/sends?profileId=profile-legacy&climbKind=saved&climbId=consensus-route",
    ),
  );
  assert.equal(response.status, 200);
  const legacyDetail = await response.json();
  assert.equal(legacyDetail.activities[0].userRating, 3);
  assert.equal(legacyDetail.userGrade, null);

  response = await saveSend("profile-alex", "V2", 4);
  assert.equal(response.status, 200);
  assert.equal((await loadClimb()).grade, "V2");
  const alexOriginalSend = database.sendFor(
    "saved",
    "consensus-route",
    "profile-alex",
  );
  assert.ok(alexOriginalSend);

  response = await saveSend("profile-blair", "V3", 5);
  assert.equal(response.status, 200);
  assert.equal((await loadClimb()).grade, "V3");

  response = await saveSend("profile-alex", "V6", 2);
  assert.equal(response.status, 200);
  assert.equal(database.sendCount(), 3);
  const alexUpdatedSend = database.sendFor(
    "saved",
    "consensus-route",
    "profile-alex",
  );
  assert.equal(alexUpdatedSend.sent_at, alexOriginalSend.sent_at);
  assert.equal(alexUpdatedSend.grade, "V6");

  climb = await loadClimb();
  assert.equal(climb.grade, "V5");
  assert.equal(climb.setterGrade, "V4");
  assert.equal(
    matchesClimbFilters(
      climb,
      parseClimbFilters(
        new URLSearchParams("min=5&max=5&outdated=show"),
      ),
    ),
    true,
  );
  assert.equal(
    matchesClimbFilters(
      climb,
      parseClimbFilters(
        new URLSearchParams("min=4&max=4&outdated=show"),
      ),
    ),
    false,
  );

  response = await fetchAppData(
    new Request("http://localhost/api/climbs"),
  );
  listedClimb = (await response.json()).climbs.find(
    (candidate) => candidate.id === "consensus-route",
  );
  assert.equal(listedClimb.grade, "V5");
  assert.equal(listedClimb.setterGrade, "V4");

  response = await fetchAppData(
    new Request(
      "http://localhost/api/sends?profileId=profile-alex&climbKind=saved&climbId=consensus-route",
    ),
  );
  const alexDetail = await response.json();
  assert.equal(alexDetail.activities[0].userRating, 2);
  assert.equal(alexDetail.userGrade, "V6");
  assert.equal(
    alexDetail.logbookEntries.find(
      (entry) => entry.profileName === "Alex",
    )?.grade,
    "V6",
  );
  assert.equal(
    alexDetail.logbookEntries.find(
      (entry) => entry.profileName === "Legacy",
    )?.grade,
    null,
  );

  response = await fetchAppData(
    new Request(
      "http://localhost/api/climbs/consensus-route/rocko-approval",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          profileId: "profile-admin",
          rockoApproved: true,
        }),
      },
    ),
  );
  assert.equal(response.status, 200);
  const approvedClimb = (await response.json()).climb;
  assert.equal(approvedClimb.grade, "V5");
  assert.equal(approvedClimb.setterGrade, "V4");
  assert.equal(approvedClimb.rockoApproved, true);
});

test("lists every sender with their current grade and star rating", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (path) =>
    worker.fetch(
      new Request(`http://localhost${path}`),
      environment,
      createContext(),
    );

  for (const profile of [
    { id: "profile-alex", name: "Alex", createdAt: 1 },
    { id: "profile-blair", name: "Blair", createdAt: 2 },
    { id: "profile-zoe", name: "Zoë", createdAt: 3 },
  ]) {
    database.seedProfile(profile);
  }
  for (const climb of [
    { id: "logbook-route", name: "Logbook Route", createdAt: 10 },
    { id: "other-route", name: "Other Route", createdAt: 11 },
    { id: "empty-route", name: "Empty Route", createdAt: 12 },
  ]) {
    database.seedClimb({
      ...climb,
      grade: "V4",
      setter: "Alex",
      holds: [
        { x: 20, y: 80, size: 7, role: "start" },
        { x: 70, y: 10, size: 7, role: "finish" },
      ],
    });
  }

  for (const send of [
    {
      climbKind: "saved",
      climbId: "logbook-route",
      profileId: "profile-alex",
      rating: 2,
      sentAt: 100,
      updatedAt: 500,
    },
    {
      climbKind: "saved",
      climbId: "logbook-route",
      profileId: "profile-zoe",
      grade: "V3",
      rating: 3,
      sentAt: 300,
      updatedAt: 300,
    },
    {
      climbKind: "saved",
      climbId: "logbook-route",
      profileId: "profile-blair",
      grade: "V6",
      rating: 5,
      sentAt: 300,
      updatedAt: 300,
    },
    {
      climbKind: "saved",
      climbId: "other-route",
      profileId: "profile-alex",
      grade: "V1",
      rating: 1,
      sentAt: 400,
      updatedAt: 400,
    },
  ]) {
    database.seedSend(send);
  }

  let response = await fetchAppData(
    "/api/sends?profileId=profile-alex&climbKind=saved&climbId=logbook-route",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload.activities, [
    {
      climbKind: "saved",
      climbId: "logbook-route",
      averageRating: 3.3,
      ratingCount: 3,
      userRating: 2,
    },
  ]);
  assert.deepEqual(payload.logbookEntries, [
    { profileName: "Blair", grade: "V6", rating: 5 },
    { profileName: "Zoë", grade: "V3", rating: 3 },
    { profileName: "Alex", grade: null, rating: 2 },
  ]);
  assert.equal(payload.userGrade, null);
  assert.equal("profileId" in payload.logbookEntries[0], false);
  assert.equal("sentAt" in payload.logbookEntries[0], false);
  assert.equal(payload.logbookEntries.length, payload.activities[0].ratingCount);

  response = await fetchAppData(
    "/api/sends?profileId=profile-alex&climbKind=saved&climbId=empty-route",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    activities: [],
    logbookEntries: [],
    userGrade: null,
  });

  response = await fetchAppData(
    "/api/sends?profileId=profile-alex&climbKind=saved",
  );
  assert.equal(response.status, 400);
  response = await fetchAppData(
    "/api/sends?profileId=profile-alex&climbKind=invalid&climbId=logbook-route",
  );
  assert.equal(response.status, 400);
  response = await fetchAppData(
    "/api/sends?profileId=profile-alex&climbKind=saved&climbId=missing-route",
  );
  assert.equal(response.status, 404);

  response = await fetchAppData("/api/sends?profileId=profile-alex");
  assert.equal(response.status, 200);
  assert.equal("logbookEntries" in (await response.json()), false);
});

test("stores climbs by preset hold id and resolves them from shared data", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
  const adminProfileId = "profile-admin";
  database.seedProfile({
    id: adminProfileId,
    name: "aDmIn",
    createdAt: 1,
  });
  const environment = createEnvironment({ DB: database });
  const fetchAppData = (request) =>
    worker.fetch(request, environment, createContext());

  const wallHolds = [
    { id: "start-hold", x: 31, y: 88, size: 7 },
    { id: "foot-hold", x: 48, y: 74, size: 6 },
    { id: "finish-hold", x: 67, y: 9, size: 8 },
  ];
  let response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: wallHolds,
        expectedUpdatedAt: 0,
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const wallRevision = (await response.json()).updatedAt;

  response = await fetchAppData(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: "Alex Rivera" }),
    }),
  );
  assert.equal(response.status, 201);
  const profileId = (await response.json()).profile.id;
  const otherProfileId = "profile-sam";
  database.seedProfile({
    id: otherProfileId,
    name: "Sam",
    createdAt: 3,
  });

  const climb = {
    id: "stable-route-one",
    name: "Stable Route",
    grade: "V17",
    setter: "Forged Name",
    createdAt: 100,
    holds: [
      { holdId: "start-hold", x: 0, y: 0, size: 1, role: "start" },
      { holdId: "foot-hold", x: 0, y: 0, size: 1, role: "foot" },
      { holdId: "finish-hold", x: 0, y: 0, size: 1, role: "finish" },
    ],
  };
  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb,
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 201);
  const savedClimb = (await response.json()).climb;
  assert.equal(savedClimb.grade, "V17");
  assert.equal(savedClimb.setterGrade, "V17");
  assert.equal(savedClimb.setter, "Alex Rivera");
  assert.equal(savedClimb.outdated, false);
  assert.equal(savedClimb.rockoApproved, false);
  assert.equal(savedClimb.holds[0].holdId, "start-hold");
  assert.equal(savedClimb.holds[0].x, wallHolds[0].x);
  assert.equal(savedClimb.holds[1].role, "foot");
  assert.equal(savedClimb.holds[1].y, wallHolds[1].y);
  assert.equal(savedClimb.holds[2].y, wallHolds[2].y);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).climbs, [savedClimb]);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).climb, savedClimb);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: {
          ...climb,
          id: "forged-rocko-approval",
          rockoApproved: true,
        },
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 400);

  const approvalUrl =
    "http://localhost/api/climbs/stable-route-one/rocko-approval";
  response = await fetchAppData(
    new Request(approvalUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: adminProfileId }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request(approvalUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ profileId, rockoApproved: true }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request(approvalUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        profileId: "unknown-profile",
        rockoApproved: true,
      }),
    }),
  );
  assert.equal(response.status, 400);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchAppData(
      new Request(approvalUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          profileId: adminProfileId,
          rockoApproved: true,
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).climb.rockoApproved, true);
  }

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal((await response.json()).climb.rockoApproved, true);

  response = await fetchAppData(new Request("http://localhost/api/climbs"));
  assert.equal(
    (await response.json()).climbs.find((item) => item.id === climb.id)
      ?.rockoApproved,
    true,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchAppData(
      new Request(approvalUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          profileId: adminProfileId,
          rockoApproved: false,
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).climb.rockoApproved, false);
  }

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal((await response.json()).climb.rockoApproved, false);

  response = await fetchAppData(
    new Request(approvalUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        profileId: adminProfileId,
        rockoApproved: true,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).climb.rockoApproved, true);

  response = await fetchAppData(new Request(approvalUrl));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "PUT");

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: { ...climb, id: "outside-grade-range", grade: "V18" },
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: {
          ...climb,
          id: "unknown-hold-role",
          holds: climb.holds.map((hold, index) =>
            index === 1 ? { ...hold, role: "feet" } : hold,
          ),
        },
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: { ...climb, id: "missing-profile-route" },
        expectedWallUpdatedAt: wallRevision,
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: { ...climb, id: "unknown-profile-route" },
        expectedWallUpdatedAt: wallRevision,
        profileId: "unknown-profile",
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb,
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 409);

  const legacyClimb = {
    ...climb,
    id: "legacy-coordinate-route",
    name: "Legacy Route",
    setter: "You",
    holds: [
      { x: 31.5, y: 87.5, size: 6, role: "start" },
      { x: 67.5, y: 9.5, size: 7, role: "finish" },
    ],
  };
  database.seedClimb(legacyClimb);
  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: legacyClimb,
        expectedWallUpdatedAt: wallRevision,
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: legacyClimb,
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).climb.setter, "Alex Rivera");

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: wallHolds.slice(1),
        expectedUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: wallHolds,
        expectedUpdatedAt: 0,
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 409);

  const movedWallHolds = wallHolds.map((hold) => ({
    ...hold,
    x: hold.x + 1,
    y: hold.y + 1,
  }));
  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: movedWallHolds,
        expectedUpdatedAt: wallRevision,
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const movedWallRevision = (await response.json()).updatedAt;

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal((await response.json()).climb.holds[0].x, movedWallHolds[0].x);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/legacy-coordinate-route"),
  );
  const migratedLegacyClimb = (await response.json()).climb;
  assert.equal(migratedLegacyClimb.holds[0].holdId, "start-hold");
  assert.equal(migratedLegacyClimb.holds[1].holdId, "finish-hold");

  response = await fetchAppData(
    new Request("http://localhost/api/sends", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climbKind: "saved",
        climbId: climb.id,
        profileId,
        grade: "V2",
        rating: 5,
      }),
    }),
  );
  assert.equal(response.status, 200);

  const climbUpdate = {
    name: "Stable Route Revised",
    grade: "V8",
    holds: climb.holds,
    expectedWallUpdatedAt: movedWallRevision,
    profileId,
  };
  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(climbUpdate),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ ...climbUpdate, profileId: "unknown-profile" }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ ...climbUpdate, profileId: otherProfileId }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        ...climbUpdate,
        expectedWallUpdatedAt: wallRevision,
      }),
    }),
  );
  assert.equal(response.status, 409);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify(climbUpdate),
    }),
  );
  assert.equal(response.status, 200);
  const updatedClimb = (await response.json()).climb;
  assert.equal(updatedClimb.name, climbUpdate.name);
  assert.equal(updatedClimb.grade, "V2");
  assert.equal(updatedClimb.setterGrade, climbUpdate.grade);
  assert.equal(updatedClimb.setter, savedClimb.setter);
  assert.equal(updatedClimb.createdAt, savedClimb.createdAt);
  assert.equal(updatedClimb.rockoApproved, true);
  assert.equal(updatedClimb.holds[0].x, movedWallHolds[0].x);
  assert.equal(updatedClimb.holds[1].role, "foot");

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        ...climbUpdate,
        name: "Admin Revised Route",
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const adminUpdatedClimb = (await response.json()).climb;
  assert.equal(adminUpdatedClimb.name, "Admin Revised Route");
  assert.equal(adminUpdatedClimb.grade, "V2");
  assert.equal(adminUpdatedClimb.setterGrade, climbUpdate.grade);
  assert.equal(adminUpdatedClimb.setter, "Alex Rivera");
  assert.equal(adminUpdatedClimb.rockoApproved, true);

  response = await fetchAppData(
    new Request(`http://localhost/api/sends?profileId=${profileId}`),
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).activities.find(
      (activity) => activity.climbId === climb.id,
    )?.userRating,
    5,
  );

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: { ...climb, id: "stale-wall-route" },
        expectedWallUpdatedAt: wallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 409);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: {
          ...climb,
          id: "unknown-hold-route",
          holds: [
            ...climb.holds.slice(0, 1),
            { holdId: "not-on-wall", x: 1, y: 1, size: 5, role: "finish" },
          ],
        },
        expectedWallUpdatedAt: movedWallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 400);

  const controlClimb = {
    ...climb,
    id: "current-control-route",
    name: "Current Control Route",
    grade: "V4",
    holds: [
      { holdId: "foot-hold", x: 0, y: 0, size: 1, role: "start" },
      { holdId: "finish-hold", x: 0, y: 0, size: 1, role: "finish" },
    ],
  };
  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: controlClimb,
        expectedWallUpdatedAt: movedWallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).climb.outdated, false);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: movedWallHolds.slice(1),
        expectedUpdatedAt: movedWallRevision,
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const deletedHoldRevision = (await response.json()).updatedAt;

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds"),
  );
  const wallAfterDeletion = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(wallAfterDeletion.holds, movedWallHolds.slice(1));

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal(response.status, 200);
  const outdatedClimb = (await response.json()).climb;
  assert.equal(outdatedClimb.outdated, true);
  assert.equal(outdatedClimb.holds[0].holdId, "start-hold");
  assert.equal(outdatedClimb.holds[0].x, movedWallHolds[0].x);
  assert.equal(outdatedClimb.holds[1].x, movedWallHolds[1].x);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/current-control-route"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).climb.outdated, false);

  response = await fetchAppData(new Request("http://localhost/api/climbs"));
  const climbsAfterDeletion = (await response.json()).climbs;
  assert.equal(
    climbsAfterDeletion.find((item) => item.id === climb.id)?.outdated,
    true,
  );
  assert.equal(
    climbsAfterDeletion.find((item) => item.id === controlClimb.id)?.outdated,
    false,
  );

  response = await fetchAppData(
    new Request(`http://localhost/api/sends?profileId=${profileId}`),
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).activities.find(
      (activity) => activity.climbId === climb.id,
    )?.userRating,
    5,
  );

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb: { ...climb, id: "deleted-hold-route" },
        expectedWallUpdatedAt: deletedHoldRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 400);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        holds: movedWallHolds.slice(2),
        expectedUpdatedAt: movedWallRevision,
        profileId: adminProfileId,
      }),
    }),
  );
  assert.equal(response.status, 409);

  response = await fetchAppData(
    new Request("http://localhost/api/wall-holds"),
  );
  assert.deepEqual((await response.json()).holds, movedWallHolds.slice(1));

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
      headers: { Origin: "https://example.com" },
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ profileId: otherProfileId }),
    }),
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "PATCH",
    }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, PUT, DELETE");

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ profileId }),
    }),
  );
  assert.equal(response.status, 204);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /deleted/i);

  response = await fetchAppData(
    new Request(approvalUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        profileId: adminProfileId,
        rockoApproved: true,
      }),
    }),
  );
  assert.equal(response.status, 410);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs"),
  );
  assert.equal(
    (await response.json()).climbs.some((item) => item.id === climb.id),
    false,
  );

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    }),
  );
  assert.equal(response.status, 410);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/legacy-coordinate-route", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ profileId: adminProfileId }),
    }),
  );
  assert.equal(response.status, 204);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        climb,
        expectedWallUpdatedAt: movedWallRevision,
        profileId,
      }),
    }),
  );
  assert.equal(response.status, 410);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/not-found"),
  );
  assert.equal(response.status, 404);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/not-found/rocko-approval", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        profileId: adminProfileId,
        rockoApproved: true,
      }),
    }),
  );
  assert.equal(response.status, 404);

  response = await worker.fetch(
    new Request("http://localhost/api/climbs"),
    createEnvironment(),
    createContext(),
  );
  assert.equal(response.status, 503);
});

test("includes the wall, app icon, and social preview image assets", async () => {
  for (const relativePath of [
    "../public/wall-prototype.png",
    "../public/a-fine-wall-icon.png",
  ]) {
    const asset = await stat(new URL(relativePath, import.meta.url));
    assert.ok(asset.isFile());
    assert.ok(asset.size > 100_000);
  }

  for (const relativePath of [
    "../public/a-fine-wall-icon-32.png",
    "../public/a-fine-wall-icon-192.png",
    "../public/a-fine-wall-icon-512.png",
    "../public/a-fine-wall-icon-maskable-1024.png",
    "../public/apple-touch-icon-v2.png",
    "../public/rocko-approved.png",
  ]) {
    const asset = await stat(new URL(relativePath, import.meta.url));
    assert.ok(asset.isFile());
    assert.ok(asset.size > 1_000);
  }

  const rockoIcon = await readFile(
    new URL("../public/rocko-approved.png", import.meta.url),
  );
  assert.equal(rockoIcon[25], 6, "Rocko icon must be an RGBA PNG");

  for (const [relativePath, expectedSize] of [
    ["../public/apple-touch-icon-v2.png", 180],
    ["../public/a-fine-wall-icon-maskable-1024.png", 1024],
  ]) {
    const icon = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(icon.readUInt32BE(16), expectedSize);
    assert.equal(icon.readUInt32BE(20), expectedSize);
    assert.equal(icon[25], 2, `${relativePath} must be an opaque RGB PNG`);
  }

  for (const relativePath of [
    "../dist/client/apple-touch-icon-v2.png",
    "../dist/client/a-fine-wall-icon-maskable-1024.png",
    "../dist/client/sw.js",
    "../dist/client/offline.html",
  ]) {
    const asset = await stat(new URL(relativePath, import.meta.url));
    assert.ok(asset.isFile(), `${relativePath} must be copied into the build`);
  }
});

test("configures a standalone home-screen app with the new icon", async () => {
  const [layoutSource, manifestSource] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../public/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.name, "A Fine Wall");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/climbs");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.display_override, ["standalone"]);
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => ({
      src,
      sizes,
      purpose,
    })),
    [
      {
        src: "/a-fine-wall-icon-192.png",
        sizes: "192x192",
        purpose: "any",
      },
      {
        src: "/a-fine-wall-icon-512.png",
        sizes: "512x512",
        purpose: "any",
      },
      {
        src: "/a-fine-wall-icon-maskable-1024.png",
        sizes: "1024x1024",
        purpose: "maskable",
      },
    ],
  );

  assert.match(layoutSource, /export const metadata:\s*Metadata\s*=\s*\{/);
  assert.doesNotMatch(layoutSource, /generateMetadata/);
  assert.match(layoutSource, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(layoutSource, /appleWebApp:\s*\{/);
  assert.match(layoutSource, /"apple-mobile-web-app-capable":\s*"yes"/);
  assert.match(layoutSource, /\/apple-touch-icon-v2\.png/);
  assert.match(layoutSource, /\/a-fine-wall-icon\.png/);
  assert.match(layoutSource, /card:\s*"summary"/);
  assert.match(layoutSource, /viewport-fit=cover/);

  const iPhoneSafariUserAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 " +
    "Mobile/15E148 Safari/604.1";
  for (const pathname of ["/climbs", "/set-climb"]) {
    const response = await render(pathname, {
      "user-agent": iPhoneSafariUserAgent,
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    const headEnd = html.indexOf("</head>");
    assert.ok(headEnd > 0, `${pathname} must render a document head`);
    const head = html.slice(0, headEnd);

    assert.match(
      head,
      /<link(?=[^>]*rel="manifest")(?=[^>]*href="\/manifest\.webmanifest")[^>]*>/,
    );
    assert.match(
      head,
      /<link(?=[^>]*rel="apple-touch-icon")(?=[^>]*href="\/apple-touch-icon-v2\.png")[^>]*>/,
    );
    assert.match(
      head,
      /<meta(?=[^>]*name="apple-mobile-web-app-capable")(?=[^>]*content="yes")[^>]*>/,
    );
    assert.match(
      head,
      /<meta(?=[^>]*name="apple-mobile-web-app-title")(?=[^>]*content="A Fine Wall")[^>]*>/,
    );
    assert.match(
      head,
      /<meta(?=[^>]*name="viewport")(?=[^>]*content="[^"]*viewport-fit=cover)[^>]*>/,
    );
    assert.match(
      head,
      /content="https:\/\/a-fine-wall\.bnugent1021\.workers\.dev\/a-fine-wall-icon\.png"/,
    );
  }
});

test("registers a navigation-only service worker with a safe offline fallback", async () => {
  const [layoutSource, registrationSource, serviceWorkerSource, offlineSource] =
    await Promise.all([
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/pwa-registration.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
      readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
    ]);

  assert.match(layoutSource, /<PwaRegistration\s*\/>/);
  assert.match(registrationSource, /process\.env\.NODE_ENV !== "production"/);
  assert.match(registrationSource, /window\.isSecureContext/);
  assert.match(registrationSource, /\.register\("\/sw\.js"/);
  assert.match(registrationSource, /scope:\s*"\/"/);
  assert.match(registrationSource, /updateViaCache:\s*"none"/);

  for (const eventName of ["install", "activate", "fetch"]) {
    assert.match(
      serviceWorkerSource,
      new RegExp(`addEventListener\\("${eventName}"`),
    );
  }
  assert.match(serviceWorkerSource, /request\.mode !== "navigate"/);
  assert.match(serviceWorkerSource, /url\.pathname === "\/api"/);
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorkerSource, /await fetch\(request\)/);
  assert.match(serviceWorkerSource, /cache\.match\(OFFLINE_URL\)/);
  assert.match(serviceWorkerSource, /navigationPreload\.enable\(\)/);
  assert.doesNotMatch(serviceWorkerSource, /cache\.put\(/);
  assert.match(offlineSource, /<h1>You’re offline<\/h1>/);
  assert.match(offlineSource, /href="\/climbs"/);
});

test("cleanup migration removes only retired prototype send activity", async () => {
  const migration = await readFile(
    new URL("../drizzle/0004_remove_sample_climbs.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /DELETE FROM `climb_sends`/);
  assert.match(migration, /`climb_kind` = 'demo'/);
  for (const slug of [
    "first-light",
    "barn-door-protocol",
    "quiet-feet",
    "static-bloom",
    "redline",
  ]) {
    assert.match(migration, new RegExp(`'${slug}'`));
  }
  assert.doesNotMatch(migration, /DELETE FROM `profiles`/);
  assert.doesNotMatch(migration, /DELETE FROM `climbs`/);
});

test("case-insensitive username migration preserves profiles and merges aliases", async () => {
  const migration = await readFile(
    new URL("../drizzle/0005_wealthy_madame_hydra.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /COLLATE NOCASE/);
  assert.match(migration, /UPDATE `climbs`/);
  assert.match(migration, /INSERT INTO `climb_sends`/);
  assert.match(migration, /DELETE FROM `climb_sends`/);
  assert.match(migration, /CREATE INDEX `idx_profiles_name_nocase`/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /DELETE FROM `profiles`/);
});

test("adds Rocko approval without replacing or deleting existing climbs", async () => {
  const migration = await readFile(
    new URL("../drizzle/0006_peaceful_mercury.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /ALTER TABLE `climbs` ADD `rocko_approved` integer DEFAULT false NOT NULL/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|CREATE TABLE/);
});

test("adds nullable send grades without rewriting legacy sends", async () => {
  const [migration, snapshotSource, journalSource, schemaSource, workerSource] =
    await Promise.all([
      readFile(
        new URL("../drizzle/0007_previous_peter_quill.sql", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../drizzle/meta/0007_snapshot.json", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../worker/app-data.ts", import.meta.url), "utf8"),
    ]);
  const snapshot = JSON.parse(snapshotSource);
  const journal = JSON.parse(journalSource);

  assert.equal(
    migration.trim(),
    "ALTER TABLE `climb_sends` ADD `grade` text;",
  );
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP TABLE|CREATE TABLE/i);
  assert.deepEqual(snapshot.tables.climb_sends.columns.grade, {
    name: "grade",
    type: "text",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  });
  assert.equal(journal.entries.at(-1)?.tag, "0007_previous_peter_quill");
  assert.match(schemaSource, /grade:\s*text\("grade"\)/);
  assert.match(workerSource, /PRAGMA table_info\(climb_sends\)/);
  assert.match(workerSource, /ALTER TABLE climb_sends ADD COLUMN grade TEXT/);
  assert.doesNotMatch(
    workerSource.match(
      /async function ensureClimbSendGradeColumn[\s\S]*?\n\}/,
    )?.[0] ??
      "",
    /UPDATE climb_sends/i,
  );
});

test("shows only clean colored circles for selected route holds", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const markerRule = css.match(/\.hold-marker\s*\{([^}]*)\}/)?.[1] ?? "";
  const choiceRule = css.match(/\.hold-choice::after\s*\{([^}]*)\}/)?.[1] ?? "";
  const availableRule =
    css.match(/\.hold-choice--available::after\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(markerRule, /box-shadow/);
  assert.match(choiceRule, /background:\s*transparent/);
  assert.doesNotMatch(choiceRule, /box-shadow/);
  assert.match(availableRule, /opacity:\s*0/);
});

test("uses brighter blue and green specifically for hold circles", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /--hold-hand:\s*#168cff/);
  assert.match(css, /--hold-start:\s*#20d968/);
  assert.match(
    css.match(/\.hold-marker--hand\s*\{([^}]*)\}/)?.[1] ?? "",
    /var\(--hold-hand\)/,
  );
  assert.match(
    css.match(/\.hold-choice--start\s*\{([^}]*)\}/)?.[1] ?? "",
    /var\(--hold-start\)/,
  );
});

test("styles footholds as yellow circles", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /--hold-foot:\s*#ffd400/);
  assert.match(
    css.match(/\.hold-marker--foot\s*\{([^}]*)\}/)?.[1] ?? "",
    /var\(--hold-foot\)/,
  );
  assert.match(
    css.match(/\.hold-choice--foot\s*\{([^}]*)\}/)?.[1] ?? "",
    /var\(--hold-foot\)/,
  );
});

test("allows native two-axis panning on interactive wall layers", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  for (const selector of [
    "wall-hold-choice-layer",
    "wall-holds-tap-layer",
  ]) {
    const rule = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const value = rule.match(/touch-action:\s*([^;]+)/)?.[1]?.trim() ?? "";

    assert.ok(
      value === "auto" ||
        ["pan-x", "pan-y", "pinch-zoom"].every((action) =>
          value.split(/\s+/).includes(action),
        ),
      `Expected .${selector} to allow horizontal, vertical, and pinch gestures; received "${value}"`,
    );
  }

  const resizeHandleRule =
    css.match(/\.wall-hold-resize-handle\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(resizeHandleRule, /touch-action:\s*none/);
});

test("dims climb walls while restoring normal brightness inside route circles", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const photoRule =
    css.match(/\.wall-map--route \.wall-photo\s*\{([^}]*)\}/)?.[1] ?? "";
  const markerRule =
    css.match(/\.wall-map--route \.hold-marker\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(photoRule, /filter:\s*brightness\(0\.6\)/);
  assert.match(markerRule, /overflow:\s*hidden/);
  assert.match(markerRule, /background:\s*transparent/);
  assert.match(markerRule, /-webkit-backdrop-filter:\s*brightness\(1\.67\)/);
  assert.match(markerRule, /(?<!webkit-)backdrop-filter:\s*brightness\(1\.67\)/);
});

test("normalizes and remembers the active user profile", () => {
  assert.equal(normalizeUserName("  Zoë   O’Connor  "), "Zoë O’Connor");
  assert.equal(normalizeUserName("   "), null);
  assert.equal(normalizeUserName("You"), null);
  assert.equal(normalizeUserName("you"), null);
  assert.equal(normalizeUserName("yOu"), null);
  assert.equal(normalizeUserName("Bad\nName"), null);
  assert.equal(normalizeUserName("x".repeat(MAX_USER_NAME_LENGTH)), "x".repeat(50));
  assert.equal(normalizeUserName("x".repeat(MAX_USER_NAME_LENGTH + 1)), null);
  assert.equal(parseUserProfile(null), null);
  assert.equal(parseUserProfile("not json"), null);

  const cookieProfile = { id: "profile-cookie", name: "ZoÃ« Oâ€™Connor" };
  const cookieValue = serializeUserProfileCookie(cookieProfile);
  assert.deepEqual(
    parseUserProfileCookie(
      `unrelated=value; ${USER_PROFILE_COOKIE_KEY}=${cookieValue}; theme=dark`,
    ),
    cookieProfile,
  );
  assert.equal(parseUserProfileCookie(null), null);
  assert.equal(
    parseUserProfileCookie(`${USER_PROFILE_COOKIE_KEY}=not-json`),
    null,
  );
  assert.equal(resolveCachedUserProfile(null, cookieProfile), cookieProfile);
  const newerBrowserProfile = { id: "profile-newer", name: "Newer User" };
  assert.equal(
    resolveCachedUserProfile(newerBrowserProfile, cookieProfile),
    newerBrowserProfile,
  );
  assert.equal(resolveCachedUserProfile(null, null), null);

  const profile = { id: "profile-1", name: "Alex Rivera" };
  assert.deepEqual(parseUserProfile(JSON.stringify(profile)), profile);
  assert.equal(
    parseUserProfile(JSON.stringify({ ...profile, id: "bad id" })),
    null,
  );

  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  persistUserProfile(storage, profile);
  assert.equal(values.has(USER_PROFILE_KEY), true);
  assert.deepEqual(readUserProfile(storage), profile);
  removeUserProfile(storage);
  assert.equal(readUserProfile(storage), null);
});

test("safely parses and stores device-local climbs", () => {
  assert.equal(nextSavedHoldRole("hand"), "foot");
  assert.equal(nextSavedHoldRole("foot"), "start");
  assert.equal(nextSavedHoldRole("start"), "finish");
  assert.equal(nextSavedHoldRole("finish"), null);

  const climb = {
    id: "corner-pocket-1",
    name: "Corner Pocket",
    grade: "V17",
    setter: "Alex Rivera",
    profileId: "profile-1",
    createdAt: 100,
    holds: [
      { x: 27, y: 91, size: 6, role: "start" },
      { x: 33, y: 84, size: 7, role: "start" },
      { x: 43, y: 78, size: 9, role: "hand" },
      { x: 51, y: 66, size: 7, role: "foot" },
      { x: 66, y: 9, size: 9, role: "finish" },
      { x: 74, y: 7, size: 7, role: "finish" },
    ],
  };

  assert.deepEqual(parseSavedClimbs(null), []);
  assert.deepEqual(parseSavedClimbs("not json"), []);
  assert.deepEqual(parseSavedClimbs(JSON.stringify([climb, { broken: true }])), [
    climb,
  ]);
  const approvedClimb = { ...climb, rockoApproved: true };
  assert.deepEqual(parseSavedClimbs(JSON.stringify([approvedClimb])), [
    approvedClimb,
  ]);
  const outdatedClimb = { ...climb, outdated: true };
  assert.deepEqual(parseSavedClimbs(JSON.stringify([outdatedClimb])), [
    outdatedClimb,
  ]);
  assert.deepEqual(
    parseSavedClimbs(JSON.stringify([{ ...climb, outdated: "yes" }])),
    [],
  );
  assert.deepEqual(
    parseSavedClimbs(
      JSON.stringify([{ ...climb, rockoApproved: "true" }]),
    ),
    [],
  );
  const legacyClimb = {
    ...climb,
    id: "legacy-climb",
    setter: "You",
  };
  delete legacyClimb.profileId;
  assert.deepEqual(parseSavedClimbs(JSON.stringify([legacyClimb])), [
    legacyClimb,
  ]);
  const attributedLegacyClimb = attributeSavedClimb(legacyClimb, {
    id: "profile-2",
    name: "Casey",
  });
  assert.deepEqual(attributedLegacyClimb, {
    ...legacyClimb,
    setter: "Casey",
    profileId: "profile-2",
  });
  assert.equal(
    attributeSavedClimb(climb, { id: "profile-2", name: "Casey" }),
    climb,
  );
  assert.deepEqual(
    parseSavedClimbs(JSON.stringify([{ ...climb, setter: " " }])),
    [],
  );
  assert.deepEqual(
    parseSavedClimbs(JSON.stringify([{ ...climb, setter: "x".repeat(51) }])),
    [],
  );
  assert.deepEqual(
    parseSavedClimbs(JSON.stringify([{ ...climb, grade: "V18" }])),
    [],
  );

  const linkedHold = { ...climb.holds[0], holdId: "stable-hold-a" };
  assert.deepEqual(
    resolveSavedHold(linkedHold, [
      { id: "stable-hold-a", x: 12, y: 34, size: 8 },
    ]),
    { ...linkedHold, x: 12, y: 34, size: 8 },
  );
  assert.deepEqual(
    parseSavedClimbs(
      JSON.stringify([
        {
          ...climb,
          id: "no-start",
          holds: climb.holds.map((hold) => ({ ...hold, role: "hand" })),
        },
      ]),
    ),
    [],
  );
  assert.deepEqual(
    parseSavedClimbs(
      JSON.stringify([
        {
          ...climb,
          id: "no-finish",
          holds: climb.holds.map((hold) => ({
            ...hold,
            role: hold.role === "finish" ? "hand" : hold.role,
          })),
        },
      ]),
    ),
    [],
  );

  const replaced = { ...climb, name: "Corner Pocket Direct", createdAt: 200 };
  assert.deepEqual(addSavedClimb([climb], replaced), [replaced]);

  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };

  persistSavedClimb(storage, climb);
  assert.deepEqual(readSavedClimbs(storage), [climb]);
  persistSavedClimbs(storage, [climb, attributedLegacyClimb]);
  assert.deepEqual(readSavedClimbs(storage), [climb, attributedLegacyClimb]);
  assert.deepEqual(removeSavedClimb(storage, climb.id), [
    attributedLegacyClimb,
  ]);
  removeSavedClimb(storage, attributedLegacyClimb.id);
  assert.deepEqual(readSavedClimbs(storage), []);
});

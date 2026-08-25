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
  buildFilteredHref,
  compareClimbsByOrder,
  filterClimbs,
  hasClimbFilterConstraints,
  matchesClimbActivityFilters,
  matchesClimbFilters,
  parseClimbFilters,
  serializeClimbFilters,
  uniqueFilterAuthors,
} from "../app/climbs/climb-filters.ts";
import { getClimbListState } from "../app/climbs/climb-list-state.ts";
import {
  climbActivityKey,
  DEMO_CLIMB_IDS,
  findClimbActivity,
  formatAverageRating,
  isClimbReference,
  parseClimbActivitiesPayload,
} from "../app/climbs/climb-activity.ts";
import { climbs as demoClimbs } from "../app/climbs/data.ts";
import {
  resolveSavedHold,
  wallHoldSizeFromHorizontalDrag,
  wallSetupReturnPath,
} from "../app/climbs/wall-holds.ts";
import {
  MAX_USER_NAME_LENGTH,
  USER_PROFILE_KEY,
  normalizeUserName,
  parseUserProfile,
  persistUserProfile,
  readUserProfile,
  removeUserProfile,
} from "../app/user-profile.ts";

async function render(pathname = "/") {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
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

  function createStatement(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    return {
      bind(...nextValues) {
        return createStatement(sql, nextValues);
      },
      async all() {
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
            rating,
            sent_at: existing?.sent_at ?? sentAt,
            updated_at: updatedAt,
          };
          savedSends.set(key, send);
          return send;
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
            "returning id, name, grade, setter, created_at, holds_json",
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
        if (
          normalized.startsWith("create table") ||
          normalized.startsWith("create index")
        ) {
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
      return Promise.all(statements.map((statement) => statement.run()));
    },
    seedClimb(climb) {
      savedClimbs.set(climb.id, {
        id: climb.id,
        name: climb.name,
        grade: climb.grade,
        setter: climb.setter,
        created_at: climb.createdAt,
        holds_json: JSON.stringify(climb.holds),
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
      savedSends.set(
        memorySendKey(send.climbKind, send.climbId, send.profileId),
        {
          climb_kind: send.climbKind,
          climb_id: send.climbId,
          profile_id: send.profileId,
          rating: send.rating,
          sent_at: send.sentAt,
          updated_at: send.updatedAt,
        },
      );
    },
    sendCount() {
      return savedSends.size;
    },
  };
}

test("renders the minimal home screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Opening the wall/);
  assert.match(html, /<title>A Fine Wall<\/title>/i);
  assert.match(html, /<h1>A Fine Wall<\/h1>/i);
  assert.match(html, /href="\/climbs"/i);
  assert.match(html, />View Climbs<\/a>/i);
});

test("renders the shared-climb shell without prototype climbs", async () => {
  const response = await render("/climbs");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /href="\/wall-photo"/i);
  assert.match(html, />Wall Setup<\/a>/i);
  assert.match(html, /href="\/set-climb"/i);
  assert.match(html, />Set Climb<\/a>/i);
  assert.match(html, /href="\/climbs\/filter"/i);
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

test("renders the climb filter controls and applies URL filters", async () => {
  let response = await render("/climbs");
  assert.equal(response.status, 200);
  let html = await response.text();
  assert.match(html, /href="\/climbs\/filter"/i);
  assert.match(html, />Filter<\/a>/i);

  response = await render("/climbs?min=3&max=3");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /Loading climbs/);
  assert.doesNotMatch(html, /First Light/);
  assert.doesNotMatch(html, /Barn Door Protocol/);
  assert.doesNotMatch(html, /Static Bloom/);
  assert.doesNotMatch(html, /Redline/);

  response = await render("/climbs?hold=stable-hold");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /Loading climbs/);
  assert.doesNotMatch(html, /No climbs match these filters/);

  response = await render("/climbs/filter?min=2&max=9");
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /<h1 id="filter-heading">Filter climbs<\/h1>/);
  assert.match(html, /type="range"/);
  assert.match(html, /Minimum/);
  assert.match(html, /Maximum/);
  assert.match(html, /Hide sent climbs/);
  assert.match(html, /Minimum community rating/);
  assert.match(html, /Most ascents/);
  assert.match(html, /Choose Holds/);
  assert.match(html, /Author/);
  for (const fakeAuthor of ["Ben", "Maya", "Sam", "Lena", "Jordan"]) {
    assert.doesNotMatch(html, new RegExp(`>${fakeAuthor}<`));
  }

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
      "min=11&max=3&author=Sam&author=Alex&author=alex&hold=hold-b&hold=hold-a&hold=bad%20hold&sent=hide&stars=4&order=ascents",
    ),
  );
  assert.deepEqual(filters, {
    minGrade: 3,
    maxGrade: 11,
    authors: ["Alex", "Sam"],
    holdIds: ["hold-a", "hold-b"],
    hideSent: true,
    minStars: 4,
    order: "ascents",
  });
  assert.equal(activeClimbFilterCount(filters), 6);
  assert.equal(hasClimbFilterConstraints(filters), true);
  assert.equal(
    serializeClimbFilters(filters),
    "min=3&max=11&author=Alex&author=Sam&hold=hold-a&hold=hold-b&sent=hide&stars=4&order=ascents",
  );
  assert.equal(
    buildFilteredHref("/climbs/saved", filters, { id: "route 1" }),
    "/climbs/saved?min=3&max=11&author=Alex&author=Sam&hold=hold-a&hold=hold-b&sent=hide&stars=4&order=ascents&id=route+1",
  );

  const candidates = [
    {
      name: "Lower bound",
      grade: "V3",
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Author alternative",
      grade: "V5",
      setter: "sAm",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Upper bound",
      grade: "V11",
      setter: "Alex",
      holds: [{ holdId: "hold-a" }, { holdId: "hold-b" }],
    },
    {
      name: "Missing hold",
      grade: "V5",
      setter: "Alex",
      holds: [{ holdId: "hold-a" }],
    },
    {
      name: "Coordinate only",
      grade: "V5",
      setter: "Alex",
      holds: [{ x: 25, y: 40 }],
    },
    {
      name: "Out of range",
      grade: "V12",
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
  assert.deepEqual(
    uniqueFilterAuthors([
      " Sam ",
      "Alex",
      "Sam",
      "alex",
      "Bad\nName",
    ]),
    ["Alex", "Sam"],
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
  assert.deepEqual(parseClimbFilters(new URLSearchParams("stars=bad")), {
    minGrade: 0,
    maxGrade: 17,
    authors: [],
    holdIds: [],
    hideSent: false,
    minStars: 0,
    order: "newest",
  });
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
  assert.match(html, /href="\/wall-photo"/);
  assert.match(html, />Wall Setup<\/a>/);
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

test("renders the wall photo upload screen", async () => {
  const response = await render("/wall-photo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1 id="photo-heading">Upload your wall<\/h1>/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, />Continue to Mark Holds<\/button>/);
  assert.match(html, /href="\/wall-holds"/);
  assert.match(html, />Edit Hold Spots<\/a>/);
  assert.doesNotMatch(html, /Restore Test Photo/);
  assert.match(html, /JPG, PNG, or WebP/);
  assert.match(html, /Existing hold spots and climbs will carry over/);
});

test("renders the preset hold spot editor after photo upload", async () => {
  const response = await render("/wall-holds?from=photo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1 id="wall-holds-heading">Mark every hold<\/h1>/);
  assert.match(html, /Tap each hold on the photo to add a preset circle/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.match(html, /aria-label="Tap the wall to add a preset hold spot"/);
  assert.match(html, />Save Wall<\/button>/);
});

test("resizes selected wall circles with a direct manipulation handle", async () => {
  const source = await readFile(
    new URL("../app/wall-holds/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /className="wall-hold-resize-handle"/);
  assert.match(source, /role="slider"/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /onPointerCancel=\{finishResize\}/);
  assert.doesNotMatch(source, /wall-hold-size-slider/);
  assert.doesNotMatch(source, /id="wall-hold-size"/);

  assert.equal(wallHoldSizeFromHorizontalDrag(7, 7, 350), 11);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, -100, 350), 1);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, 100, 350), 20);
  assert.equal(wallHoldSizeFromHorizontalDrag(7, 100, 0), 7);
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
  assert.match(html, /Loading climb/);
});

test("puts climb editing and deletion in the detail overflow menu", async () => {
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
  assert.doesNotMatch(source, /className="climb-detail-actions"/);
  assert.doesNotMatch(source, /className="delete-climb-button"/);
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

test("returns not found for an unknown climb", async () => {
  const response = await render("/climbs/not-a-real-climb");
  assert.equal(response.status, 404);
});

test("uploads, serves, and resets the shared wall photo", async () => {
  const worker = await loadWorker();
  const bucket = createMemoryWallPhotoBucket();
  const environment = createEnvironment({ WALL_PHOTOS: bucket });
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
      headers: { Origin: "http://localhost" },
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
  const fetchWallPhoto = (request, environment = createEnvironment({
    WALL_PHOTOS: createMemoryWallPhotoBucket(),
  })) => worker.fetch(request, environment, createContext());

  let response = await fetchWallPhoto(
    new Request("http://localhost/api/wall-photo", {
      method: "POST",
      headers: {
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
      body: JSON.stringify({ holds, expectedUpdatedAt: 0 }),
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
        Origin: "https://example.com",
      },
      body: JSON.stringify({
        holds,
        expectedUpdatedAt: savedHoldMap.updatedAt,
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
  const savedSend = (profileId, rating, climbId = "saved-route-one") =>
    send({ climbKind: "saved", climbId, profileId, rating });

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
  response = await send({
    climbKind: "demo",
    climbId: "first-light",
    profileId: "profile-alex",
    rating: 3,
  });
  assert.equal(response.status, 400);
  response = await send({
    climbKind: "saved",
    climbId: "unknown-saved-climb",
    profileId: "profile-alex",
    rating: 3,
  });
  assert.equal(response.status, 404);
  response = await savedSend("unknown-profile", 3);
  assert.equal(response.status, 400);
  response = await send({
    climbKind: "saved",
    climbId: "saved-route-one",
    profileId: "profile-alex",
    rating: 3,
    averageRating: 5,
  });
  assert.equal(response.status, 400);
  response = await send(
    {
      climbKind: "saved",
      climbId: "saved-route-one",
      profileId: "profile-alex",
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
      rating: 3,
    },
    "https://example.com",
  );
  assert.equal(response.status, 403);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/saved-route-one", {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(database.sendCount(), 1);

  response = await send({
    climbKind: "saved",
    climbId: "saved-route-one",
    profileId: "profile-alex",
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
    new Request("http://localhost/api/sends", { method: "DELETE" }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
});

test("stores climbs by preset hold id and resolves them from shared data", async () => {
  const worker = await loadWorker();
  const database = createMemoryAppDatabase();
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
      body: JSON.stringify({ holds: wallHolds, expectedUpdatedAt: 0 }),
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
  assert.equal(savedClimb.setter, "Alex Rivera");
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
      }),
    }),
  );
  assert.equal(response.status, 409);

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
  assert.equal(updatedClimb.grade, climbUpdate.grade);
  assert.equal(updatedClimb.setter, savedClimb.setter);
  assert.equal(updatedClimb.createdAt, savedClimb.createdAt);
  assert.equal(updatedClimb.holds[0].x, movedWallHolds[0].x);
  assert.equal(updatedClimb.holds[1].role, "foot");

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
      method: "PATCH",
    }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, PUT, DELETE");

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one", {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    }),
  );
  assert.equal(response.status, 204);

  response = await fetchAppData(
    new Request("http://localhost/api/climbs/stable-route-one"),
  );
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /deleted/i);

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

  response = await worker.fetch(
    new Request("http://localhost/api/climbs"),
    createEnvironment(),
    createContext(),
  );
  assert.equal(response.status, 503);
});

test("includes the wall and social preview image assets", async () => {
  for (const relativePath of [
    "../public/wall-prototype.png",
    "../public/og-climbs.png",
  ]) {
    const asset = await stat(new URL(relativePath, import.meta.url));
    assert.ok(asset.isFile());
    assert.ok(asset.size > 100_000);
  }
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
    "wall-tap-layer",
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

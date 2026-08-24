import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import {
  addSavedClimb,
  nextSavedHoldRole,
  parseSavedClimbs,
  persistSavedClimb,
  readSavedClimbs,
} from "../app/climbs/saved-climbs.ts";

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

test("renders the minimal home screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>A Fine Wall<\/title>/i);
  assert.match(html, /<h1>A Fine Wall<\/h1>/i);
  assert.match(html, /href="\/climbs"/i);
  assert.match(html, />View Climbs<\/a>/i);
});

test("renders five linked climbs with names and grades", async () => {
  const response = await render("/climbs");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /href="\/wall-photo"/i);
  assert.match(html, />Wall Photo<\/a>/i);
  assert.match(html, /href="\/set-climb"/i);
  assert.match(html, />Set Climb<\/a>/i);
  for (const [slug, name, grade] of [
    ["first-light", "First Light", "V2"],
    ["barn-door-protocol", "Barn Door Protocol", "V5"],
    ["quiet-feet", "Quiet Feet", "V3"],
    ["static-bloom", "Static Bloom", "V4"],
    ["redline", "Redline", "V6"],
  ]) {
    assert.match(html, new RegExp(`href="/climbs/${slug}"`, "i"));
    assert.match(html, new RegExp(name));
    assert.match(html, new RegExp(`>${grade}<`));
  }
});

test("renders the climb setter with the wall and selectable holds", async () => {
  const response = await render("/set-climb");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Choose your holds/);
  assert.match(html, /Tap once for a blue climb hold/);
  assert.match(html, /three times for a red finish/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.match(html, /href="\/wall-photo"/);
  assert.match(html, />Change Wall Photo<\/a>/);
  assert.match(html, /aria-label="Tap the wall to add a hold"/);
  assert.match(html, />Done<\/button>/);
});

test("renders the wall photo upload screen", async () => {
  const response = await render("/wall-photo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1 id="photo-heading">Upload your wall<\/h1>/);
  assert.match(html, /src="\/api\/wall-photo"/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, />Use This Photo<\/button>/);
  assert.match(html, />Restore Test Photo<\/button>/);
  assert.match(html, /JPG, PNG, or WebP/);
  assert.match(html, /Existing circles may no longer line up/);
});

test("renders the browser-saved climb detail shell", async () => {
  const response = await render("/climbs/saved?id=test-climb");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /href="\/climbs"/i);
  assert.match(html, /Loading climb/);
});

test("renders every climb wall with its complete route overlay", async () => {
  for (const [slug, name, markerCount] of [
    ["first-light", "First Light", 9],
    ["barn-door-protocol", "Barn Door Protocol", 10],
    ["quiet-feet", "Quiet Feet", 10],
    ["static-bloom", "Static Bloom", 11],
    ["redline", "Redline", 10],
  ]) {
    const response = await render(`/climbs/${slug}`);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, new RegExp(name));
    assert.match(html, /src="\/api\/wall-photo"/);
    assert.match(html, /hold-marker--start/);
    assert.match(html, /hold-marker--hand/);
    assert.match(html, /hold-marker--finish/);
    assert.match(html, /Hold marker legend/);
    assert.match(html, /green-circled start/);
    assert.doesNotMatch(html, /hold-marker-label/);
    assert.equal(
      (
        html.match(
          /<span aria-hidden="true" class="hold-marker hold-marker--/g,
        ) ?? []
      ).length,
      markerCount,
    );
  }
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

test("safely parses and stores device-local climbs", () => {
  assert.equal(nextSavedHoldRole("hand"), "start");
  assert.equal(nextSavedHoldRole("start"), "finish");
  assert.equal(nextSavedHoldRole("finish"), null);

  const climb = {
    id: "corner-pocket-1",
    name: "Corner Pocket",
    grade: "V4",
    setter: "You",
    createdAt: 100,
    holds: [
      { x: 27, y: 91, size: 6, role: "start" },
      { x: 33, y: 84, size: 7, role: "start" },
      { x: 43, y: 78, size: 9, role: "hand" },
      { x: 66, y: 9, size: 9, role: "finish" },
      { x: 74, y: 7, size: 7, role: "finish" },
    ],
  };

  assert.deepEqual(parseSavedClimbs(null), []);
  assert.deepEqual(parseSavedClimbs("not json"), []);
  assert.deepEqual(parseSavedClimbs(JSON.stringify([climb, { broken: true }])), [
    climb,
  ]);
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
});

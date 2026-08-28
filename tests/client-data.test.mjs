import assert from "node:assert/strict";
import test from "node:test";
import { loadClimb, loadClimbs } from "../app/climbs/climb-api.ts";
import { SAVED_CLIMBS_KEY } from "../app/climbs/saved-climbs.ts";
import { loadSyncedClimbs } from "../app/climbs/synced-climbs.ts";

const sharedClimb = {
  id: "shared-climb",
  name: "Shared climb",
  grade: "V4",
  setterGrade: "V3",
  setter: "Admin",
  createdAt: 1_700_000_000_000,
  holds: [
    { holdId: "hold-start", x: 20, y: 30, size: 7, role: "start" },
    { holdId: "hold-finish", x: 70, y: 15, size: 7, role: "finish" },
  ],
  rockoApproved: false,
};

const localClimb = {
  ...sharedClimb,
  id: "local-climb",
  name: "Device-local climb",
  setter: "Monica",
  profileId: "profile-monica",
};

function createStorage(climbs = []) {
  const values = new Map(
    climbs.length > 0
      ? [[SAVED_CLIMBS_KEY, JSON.stringify(climbs)]]
      : [],
  );

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

async function withFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function requestPath(input) {
  return new URL(String(input), "https://example.test").pathname;
}

test("validates successful climb API payloads at runtime", async () => {
  await withFetch(
    async () => Response.json({ climbs: [sharedClimb] }),
    async () => {
      assert.deepEqual(await loadClimbs(), [sharedClimb]);
    },
  );

  await withFetch(
    async () => Response.json({ climbs: [{ ...sharedClimb, holds: [] }] }),
    async () => {
      await assert.rejects(loadClimbs(), /Climbs could not be loaded/);
    },
  );

  await withFetch(
    async () => Response.json({ unexpected: sharedClimb }),
    async () => {
      await assert.rejects(
        loadClimb(sharedClimb.id),
        /This climb could not be loaded/,
      );
    },
  );

  await withFetch(
    async () => new Response(null, { status: 404 }),
    async () => {
      assert.equal(await loadClimb("missing-climb"), null);
    },
  );
});

test("does not remigrate a device copy that is already shared", async () => {
  const requests = [];
  const storage = createStorage([
    { ...sharedClimb, profileId: "profile-monica" },
  ]);

  const result = await withFetch(
    async (input, init = {}) => {
      requests.push({ path: requestPath(input), method: init.method ?? "GET" });
      return Response.json({ climbs: [sharedClimb] });
    },
    () =>
      loadSyncedClimbs(
        { id: "profile-monica", name: "Monica" },
        storage,
      ),
  );

  assert.deepEqual(result, {
    climbs: [sharedClimb],
    sharedUnavailable: false,
  });
  assert.deepEqual(requests, [{ path: "/api/climbs", method: "GET" }]);
});

test("migrates only device-only climbs and uses the validated server copy", async () => {
  const requests = [];
  const storage = createStorage([localClimb]);
  const controller = new AbortController();
  const migratedClimb = {
    ...sharedClimb,
    id: localClimb.id,
    name: localClimb.name,
    setter: "Monica M",
  };

  const result = await withFetch(
    async (input, init = {}) => {
      const path = requestPath(input);
      requests.push({ path, method: init.method ?? "GET", signal: init.signal });
      if (path === "/api/climbs" && !init.method) {
        return Response.json({ climbs: [sharedClimb] });
      }
      if (path === "/api/wall-holds") {
        return Response.json({ holds: [], updatedAt: 7 });
      }
      if (path === "/api/climbs" && init.method === "POST") {
        return Response.json({ climb: migratedClimb });
      }
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${path}`);
    },
    () =>
      loadSyncedClimbs(
        { id: "profile-monica", name: "Monica" },
        storage,
        controller.signal,
      ),
  );

  assert.deepEqual(result, {
    climbs: [sharedClimb, migratedClimb],
    sharedUnavailable: false,
  });
  assert.deepEqual(
    requests.map(({ path, method }) => ({ path, method })),
    [
      { path: "/api/climbs", method: "GET" },
      { path: "/api/wall-holds", method: "GET" },
      { path: "/api/climbs", method: "POST" },
    ],
  );
  assert.equal(requests.at(-1).signal, controller.signal);
});

test("keeps shared climbs usable if legacy device migration is unavailable", async () => {
  const storage = createStorage([localClimb]);

  const result = await withFetch(
    async (input, init = {}) => {
      const path = requestPath(input);
      if (path === "/api/climbs" && !init.method) {
        return Response.json({ climbs: [sharedClimb] });
      }
      if (path === "/api/wall-holds") {
        return Response.json({ error: "Unavailable" }, { status: 503 });
      }
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${path}`);
    },
    () =>
      loadSyncedClimbs(
        { id: "profile-monica", name: "Monica" },
        storage,
      ),
  );

  assert.deepEqual(result, {
    climbs: [sharedClimb, localClimb],
    sharedUnavailable: false,
  });
});

test("removes a device copy rejected by a durable tombstone", async () => {
  const storage = createStorage([localClimb]);

  const result = await withFetch(
    async (input, init = {}) => {
      const path = requestPath(input);
      if (path === "/api/climbs" && !init.method) {
        return Response.json({ climbs: [sharedClimb] });
      }
      if (path === "/api/wall-holds") {
        return Response.json({ holds: [], updatedAt: 7 });
      }
      if (path === "/api/climbs" && init.method === "POST") {
        return Response.json(
          { error: "This climb was deleted." },
          { status: 410 },
        );
      }
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${path}`);
    },
    () =>
      loadSyncedClimbs(
        { id: "profile-monica", name: "Monica" },
        storage,
      ),
  );

  assert.deepEqual(result, {
    climbs: [sharedClimb],
    sharedUnavailable: false,
  });
  assert.equal(storage.getItem(SAVED_CLIMBS_KEY), "[]");
});

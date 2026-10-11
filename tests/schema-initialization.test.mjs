import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { handleAppDataRequest } from "../worker/app-data.ts";

function databaseWithInitialization(batch) {
  return {
    batch,
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          return { results: sql.startsWith("PRAGMA")
            ? [{ name: "rocko_approved" }, { name: "grade" }, { name: "description" }]
            : [] };
        },
      };
    },
  };
}

const request = () => new Request("https://wall.test/api/profiles");

test("a request does not wait on another request's unfinished database initialization", async () => {
  let releaseFirst;
  const firstBatch = new Promise(resolve => { releaseFirst = resolve; });
  let batches = 0;
  const db = databaseWithInitialization(() => ++batches === 1 ? firstBatch : Promise.resolve([]));
  const first = handleAppDataRequest(request(), db);
  let secondFinished = false;
  const second = handleAppDataRequest(request(), db).then(response => {
    secondFinished = true;
    return response;
  });
  try {
    await setImmediate();
    assert.equal(secondFinished, true, "Another request must complete while the first is stalled");
    const response = await second;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { profiles: [] });
    assert.equal((await handleAppDataRequest(request(), db)).status, 200);
    assert.equal(batches, 2, "Only completed initialization may be cached");
  } finally {
    releaseFirst([]);
    await Promise.all([first, second]);
  }
});

test("a failed initialization is retried by the next request", async t => {
  t.mock.method(console, "error", () => {});
  let batches = 0;
  const db = databaseWithInitialization(async () => {
    if (++batches === 1) throw new Error("Request ended before initialization finished");
    return [];
  });
  assert.equal((await handleAppDataRequest(request(), db)).status, 500);
  assert.equal((await handleAppDataRequest(request(), db)).status, 200);
  assert.equal((await handleAppDataRequest(request(), db)).status, 200);
  assert.equal(batches, 2);
});

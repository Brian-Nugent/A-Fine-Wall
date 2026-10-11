import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleAppDataRequest } from "../worker/app-data.ts";

// Exercise the production SQL with real SQLite transactions, including rollback.
function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  function prepare(sql, values = []) {
    return {
      bind(...parameters) {
        return prepare(sql, parameters);
      },
      async all() {
        return {
          success: true,
          results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })),
        };
      },
      async first() {
        const row = sqlite.prepare(sql).get(...values);
        return row ? { ...row } : null;
      },
      async run() {
        sqlite.prepare(sql).run(...values);
        return { success: true };
      },
    };
  }
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function setup(t) {
  const db = createDatabase();
  t.after(() => db.sqlite.close());
  const request = (path, method = "GET", body) => handleAppDataRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    db,
  );
  const profileResponse = await request("/api/profiles", "POST", { name: "Admin" });
  assert.equal(profileResponse.status, 201);
  const profile = (await profileResponse.json()).profile;
  const holds = [
    {
      id: "start", x: 30, y: 85, size: 7,
      outline: [{ x: 27, y: 82 }, { x: 33, y: 82 }, { x: 30, y: 88 }],
    },
    { id: "finish", x: 65, y: 15, size: 7 },
  ];
  const wallResponse = await request("/api/wall-holds", "PUT", {
    profileId: profile.id,
    expectedUpdatedAt: 0,
    holds,
  });
  assert.equal(wallResponse.status, 200);
  const wallRevision = (await wallResponse.json()).updatedAt;
  const climb = {
    id: "new-climb",
    name: "First Send",
    description: "Start low and finish on the top hold.\nNo matching on the crux.",
    setter: "Ignored client name",
    grade: "V5",
    createdAt: Date.now(),
    holds: holds.map((hold, index) => ({
      holdId: hold.id,
      x: hold.x,
      y: hold.y,
      size: hold.size,
      ...(hold.outline ? { outline: hold.outline } : {}),
      role: index === 0 ? "start" : "finish",
    })),
  };
  return {
    db,
    request,
    profile,
    body: { climb, expectedWallUpdatedAt: wallRevision, profileId: profile.id },
  };
}

test("creating a climb can log its setter's grade and stars in the normal logbook", async (t) => {
  const { db, request, profile, body } = await setup(t);
  // A regular user can create and log; Admin is only needed for wall setup.
  const userResponse = await request("/api/profiles", "POST", { name: "Local Climber" });
  const user = (await userResponse.json()).profile;
  const response = await request("/api/climbs", "POST", {
    ...body,
    profileId: user.id,
    sendRating: 4,
  });
  assert.equal(response.status, 201);
  const { climb } = await response.json();
  assert.equal(climb.setter, user.name);
  assert.equal(climb.grade, "V5");
  assert.equal(climb.setterGrade, "V5");
  assert.equal(climb.description, body.climb.description);
  assert.deepEqual(climb.holds[0].outline, body.climb.holds[0].outline);

  const send = db.sqlite.prepare("SELECT * FROM climb_sends").get();
  assert.equal(send.profile_id, user.id);
  assert.equal(send.grade, "V5");
  assert.equal(send.rating, 4);
  assert.equal(send.sent_at, send.updated_at);
  assert.ok(send.sent_at > 0);

  let logbookResponse = await request(
    `/api/sends?profileId=${user.id}&climbKind=saved&climbId=${climb.id}`,
  );
  assert.equal(logbookResponse.status, 200);
  let detail = await logbookResponse.json();
  assert.equal(detail.userGrade, "V5");
  assert.equal(detail.activities[0].userRating, 4);
  assert.equal(detail.activities[0].averageRating, 4);
  assert.equal(detail.activities[0].ratingCount, 1);
  assert.deepEqual(detail.logbookEntries, [{ profileName: user.name, grade: "V5", rating: 4 }]);

  // The existing Log Send flow edits the entry instead of adding a second send.
  const updatedResponse = await request("/api/sends", "POST", {
    climbKind: "saved", climbId: climb.id, profileId: user.id, grade: "V6", rating: 5,
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT sent_at FROM climb_sends").get().sent_at, send.sent_at);
  logbookResponse = await request(
    `/api/sends?profileId=${profile.id}&climbKind=saved&climbId=${climb.id}`,
  );
  detail = await logbookResponse.json();
  assert.equal(detail.activities[0].userRating, null);
  assert.deepEqual(detail.logbookEntries, [{ profileName: user.name, grade: "V6", rating: 5 }]);
  const reloaded = await (await request(`/api/climbs/${climb.id}`)).json();
  assert.equal(reloaded.climb.description, body.climb.description);
  assert.equal(reloaded.climb.grade, "V6");
  assert.equal(reloaded.climb.setterGrade, "V5");
});

test("creating a climb without opting in does not log a send", async (t) => {
  const { db, request, body } = await setup(t);
  assert.equal((await request("/api/climbs", "POST", body)).status, 201);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 0);
});

test("invalid creation ratings are rejected before saving either record", async (t) => {
  const { db, request, body } = await setup(t);
  for (const sendRating of [0, 6, 2.5, "4", null, false]) {
    const response = await request("/api/climbs", "POST", { ...body, sendRating });
    assert.equal(response.status, 400, `rating ${JSON.stringify(sendRating)}`);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climbs").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 0);
});

test("stale walls, existing climbs, and deleted climbs cannot acquire a creation send", async (t) => {
  const { db, request, body, profile } = await setup(t);
  let response = await request("/api/climbs", "POST", {
    ...body, expectedWallUpdatedAt: 0, sendRating: 4,
  });
  assert.equal(response.status, 409);
  assert.equal((await request("/api/climbs", "POST", body)).status, 201);
  response = await request("/api/climbs", "POST", { ...body, sendRating: 4 });
  assert.equal(response.status, 409);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 0);
  response = await request(`/api/climbs/${body.climb.id}`, "DELETE", { profileId: profile.id });
  assert.equal(response.status, 204);
  response = await request("/api/climbs", "POST", { ...body, sendRating: 4 });
  assert.equal(response.status, 410);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climbs").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 0);
});

test("a failed send rolls back climb creation and allows a clean retry", async (t) => {
  const { db, request, body } = await setup(t);
  db.sqlite.exec(`
    CREATE TRIGGER fail_send BEFORE INSERT ON climb_sends
    BEGIN SELECT RAISE(ABORT, 'Simulated send failure'); END;
  `);
  const response = await request("/api/climbs", "POST", { ...body, sendRating: 3 });
  assert.equal(response.status, 500);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climbs").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 0);
  db.sqlite.exec("DROP TRIGGER fail_send");
  assert.equal((await request("/api/climbs", "POST", { ...body, sendRating: 3 })).status, 201);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climbs").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM climb_sends").get().count, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleAppDataRequest } from "../worker/app-data.ts";
import { parseSavedClimbs } from "../app/climbs/saved-climbs.ts";
import { buildFilteredHref, parseClimbFilters, serializeClimbFilters } from "../app/climbs/climb-filters.ts";

// Real SQLite exercises SQL constraints, migrations and parameter ordering.
function database(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  t.after(() => sql.close());
  const db = {
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async run() { const result = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, sql };
}

function api(db, path, method = "GET", body, origin = "https://wall.test") {
  return handleAppDataRequest(new Request(`https://wall.test${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), db);
}

async function setup(t) {
  const { db, sql } = database(t);
  assert.equal((await api(db, "/api/profiles")).status, 200);
  sql.exec("INSERT INTO profiles VALUES ('alice','Alice',1),('bob','Bob',2),('alias','ALICE',3)");
  const holds = [{ id: "start", x: 20, y: 30, size: 3 }, { id: "finish", x: 40, y: 50, size: 3 }];
  sql.prepare("UPDATE wall_configuration SET holds_json = ?, updated_at = 42 WHERE id = 1").run(JSON.stringify(holds));
  const climb = { id: "test-climb", name: "Test climb", setter: "Alice", grade: "V5", createdAt: 10,
    holds: holds.map((hold, i) => ({ holdId: hold.id, x: hold.x, y: hold.y, size: hold.size, role: i ? "finish" : "start" })) };
  return { db, sql, climb };
}

test("description persists through creation, reads, editing, old clients, and explicit clearing", async t => {
  const { db, climb } = await setup(t);
  const description = "First line\nSecond line <script> is plain text 🧗";
  const saved = await api(db, "/api/climbs", "POST", { climb: { ...climb, description: `  ${description}  ` }, expectedWallUpdatedAt: 42, profileId: "alice" });
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).climb.description, description);
  const listed = await (await api(db, "/api/climbs")).json();
  assert.equal(parseSavedClimbs(JSON.stringify(listed.climbs))[0].description, description);
  assert.equal((await (await api(db, "/api/climbs/test-climb")).json()).climb.description, description);
  const changes = { name: "Edited", grade: "V6", holds: climb.holds, expectedWallUpdatedAt: 42, profileId: "alice" };
  for (const [patch, expected] of [[{}, description], [{ description: "New beta" }, "New beta"], [{ description: "" }, undefined]]) {
    const response = await api(db, "/api/climbs/test-climb", "PUT", { ...changes, ...patch });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).climb.description, expected);
  }
});

test("description validation rejects malformed or oversized text and preserves existing data", async t => {
  const { db, climb } = await setup(t);
  for (const description of [null, 3, {}, "x".repeat(2001)]) {
    assert.equal((await api(db, "/api/climbs", "POST", { climb: { ...climb, description }, expectedWallUpdatedAt: 42, profileId: "alice" })).status, 400);
  }
  assert.equal((await api(db, "/api/climbs", "POST", { climb, expectedWallUpdatedAt: 42, profileId: "alice" })).status, 201);
  assert.equal((await api(db, "/api/climbs/test-climb", "PUT", { name: climb.name, grade: climb.grade, holds: climb.holds, description: "x".repeat(2001), expectedWallUpdatedAt: 42, profileId: "alice" })).status, 400);
  assert.equal((await (await api(db, "/api/climbs/test-climb")).json()).climb.description, undefined);
});

test("personal named lists persist, isolate profiles, share canonical aliases, and deduplicate membership", async t => {
  const { db, climb } = await setup(t);
  await api(db, "/api/climbs", "POST", { climb, expectedWallUpdatedAt: 42, profileId: "alice" });
  const created = await api(db, "/api/lists?profileId=alice", "POST", { name: "  My   projects  " });
  assert.equal(created.status, 201);
  const { list } = await created.json();
  assert.equal(list.name, "My projects");
  const route = `/api/lists/${list.id}`;
  const entry = `${route}/climbs/${climb.id}`;
  for (let i = 0; i < 2; i++) assert.equal((await api(db, `${entry}?profileId=alias`, "PUT")).status, 200);
  assert.deepEqual((await (await api(db, "/api/lists?profileId=alice")).json()).lists[0].climbIds, [climb.id]);
  assert.deepEqual((await (await api(db, "/api/lists?profileId=bob")).json()).lists, []);
  for (const [path, method, body] of [[route, "PATCH", { name: "Stolen" }], [route, "DELETE"], [entry, "PUT"], [entry, "DELETE"]]) {
    assert.equal((await api(db, `${path}?profileId=bob`, method, body)).status, 404);
  }
  assert.equal((await api(db, `${route}?profileId=alias`, "PATCH", { name: "Warm-ups" })).status, 200);
  assert.equal((await (await api(db, "/api/lists?profileId=alice")).json()).lists[0].name, "Warm-ups");
  await api(db, `${entry}?profileId=alice`, "DELETE");
  assert.deepEqual((await (await api(db, "/api/lists?profileId=alice")).json()).lists[0].climbIds, []);
  await api(db, `${entry}?profileId=alice`, "PUT");
  await api(db, `${route}?profileId=alice`, "DELETE");
  assert.deepEqual((await (await api(db, "/api/lists?profileId=alice")).json()).lists, []);
  assert.equal((await api(db, `/api/climbs/${climb.id}`)).status, 200, "Deleting a list preserves its climbs");
});

test("list input and origin checks reject invalid writes; deleting a climb removes list entries", async t => {
  const { db, sql, climb } = await setup(t);
  for (const name of ["", "   ", "x".repeat(81), null]) assert.equal((await api(db, "/api/lists?profileId=alice", "POST", { name })).status, 400);
  assert.equal((await api(db, "/api/lists?profileId=alice", "POST", { name: "Projects" }, "https://other.test")).status, 403);
  assert.equal((await api(db, "/api/lists")).status, 400);
  assert.equal((await api(db, "/api/lists?profileId=missing")).status, 404);
  await api(db, "/api/climbs", "POST", { climb, expectedWallUpdatedAt: 42, profileId: "alice" });
  const { list } = await (await api(db, "/api/lists?profileId=alice", "POST", { name: "Projects" })).json();
  assert.equal((await api(db, `/api/lists/${list.id}/climbs/missing?profileId=alice`, "PUT")).status, 404);
  await api(db, `/api/lists/${list.id}/climbs/${climb.id}?profileId=alice`, "PUT");
  assert.equal((await api(db, `/api/climbs/${climb.id}`, "DELETE", { profileId: "alice" })).status, 204);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM climb_list_entries").get().count, 0);
  assert.equal((await (await api(db, "/api/lists?profileId=alice")).json()).lists.length, 1);
});

test("list scope survives filtering, detail navigation and edit links", () => {
  const filters = parseClimbFilters(new URLSearchParams("list=personal-list&color=green&sent=hide"));
  assert.equal(filters.listId, "personal-list");
  assert.equal(parseClimbFilters(new URLSearchParams(serializeClimbFilters(filters))).listId, "personal-list");
  for (const path of ["/climbs", "/climbs/saved", "/climbs/filter", "/climbs/filter/holds", "/set-climb"]) {
    assert.match(buildFilteredHref(path, filters, { id: "test-climb" }), /[?&]list=personal-list(?:&|$)/);
  }
  assert.equal(parseClimbFilters(new URLSearchParams("list=invalid/id")).listId, undefined);
});

test("new migration adds descriptions and lists without changing wall, climb, or profile data", t => {
  const { sql } = database(t);
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  for (const entry of journal.entries.filter(entry => entry.idx < 8)) sql.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"));
  sql.exec("INSERT INTO profiles VALUES ('alice','Alice',1); INSERT INTO climbs (id,name,grade,setter,created_at,holds_json) VALUES ('climb','Existing','V5','Alice',1,'[]')");
  const before = sql.prepare("SELECT * FROM wall_configuration").all();
  sql.exec(readFileSync(new URL("../drizzle/0008_slim_stepford_cuckoos.sql", import.meta.url), "utf8"));
  assert.equal(sql.prepare("SELECT description FROM climbs WHERE id='climb'").get().description, "");
  assert.equal(sql.prepare("SELECT name FROM profiles WHERE id='alice'").get().name, "Alice");
  assert.deepEqual(sql.prepare("SELECT * FROM wall_configuration").all(), before);
});

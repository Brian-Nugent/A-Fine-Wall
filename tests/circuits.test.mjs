import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasCompleteCircuitSequence, missingCircuitOrders, nextCircuitOrder, setCircuitHolds } from "../app/climbs/climb-circuits.ts";
import { isSavedClimb, parseSavedClimbs } from "../app/climbs/saved-climbs.ts";
import CircuitHoldNumbers from "../app/climbs/circuit-hold-numbers.tsx";
import { saveClimb, updateClimb } from "../app/climbs/climb-api.ts";
import { handleAppDataRequest } from "../worker/app-data.ts";

const spots = [
  { id: "start", x: 20, y: 80, size: 5 },
  { id: "one", x: 35, y: 65, size: 6, outline: [{ x: 32, y: 62 }, { x: 38, y: 62 }, { x: 35, y: 68 }] },
  { id: "three", x: 60, y: 45, size: 5 },
  { id: "foot", x: 50, y: 90, size: 4 },
  { id: "finish", x: 80, y: 20, size: 5 },
];
const circuit = {
  id: "circuit-test", name: "A circuit", grade: "V4", setter: "Circuit Setter", createdAt: 1000,
  isCircuit: true,
  holds: spots.map(({ id, ...spot }) => ({ ...spot, holdId: id,
    role: id === "one" || id === "three" ? "hand" : id,
    ...(id === "one" ? { circuitOrder: 1 } : id === "three" ? { circuitOrder: 2 } : {}),
  })),
};
const gappedCircuit = { ...circuit, holds: circuit.holds.map(hold =>
  hold.circuitOrder === 2 ? { ...hold, circuitOrder: 3 } : hold,
) };

test("new circuit handholds use the lowest free number without renumbering existing holds", () => {
  const holds = gappedCircuit.holds.map(hold => ({ ...hold }));
  assert.equal(nextCircuitOrder([]), 1);
  assert.equal(nextCircuitOrder(holds), 2);
  assert.equal(nextCircuitOrder(holds.filter(hold => hold.circuitOrder !== 1)), 1);
  for (const role of ["foot", "start", "finish"]) {
    assert.equal(nextCircuitOrder(holds.map(hold => hold.circuitOrder === 1 ? { ...hold, role } : hold)), 1);
  }
  const added = [...holds, { role: "hand", circuitOrder: nextCircuitOrder(holds) }];
  assert.equal(nextCircuitOrder(added), 4);
  assert.deepEqual(holds.filter(hold => hold.role === "hand").map(hold => hold.circuitOrder), [1, 3]);
});

test("enabling circuits numbers existing handholds in selection order and disabling clears only numbers", () => {
  const ordinary = setCircuitHolds(gappedCircuit.holds, false);
  assert.ok(ordinary.every(hold => hold.circuitOrder === undefined));
  assert.deepEqual(setCircuitHolds(ordinary, true).filter(hold => hold.role === "hand").map(hold => hold.circuitOrder), [1, 2]);
  assert.deepEqual(ordinary.map(hold => hold.role), circuit.holds.map(hold => hold.role));
  assert.equal(gappedCircuit.holds[2].circuitOrder, 3, "The original climb must not be mutated");
});

test("complete circuits contain every number from 1 to the largest, regardless of selection order", () => {
  assert.equal(hasCompleteCircuitSequence(circuit.holds), true);
  assert.equal(hasCompleteCircuitSequence([...circuit.holds].reverse()), true);
  assert.equal(hasCompleteCircuitSequence(gappedCircuit.holds), false);
  assert.deepEqual(missingCircuitOrders(gappedCircuit.holds), [2]);
  const firstRemoved = circuit.holds.filter(hold => hold.circuitOrder !== 1);
  assert.equal(hasCompleteCircuitSequence(firstRemoved), false);
  assert.deepEqual(missingCircuitOrders(firstRemoved), [1]);
  assert.equal(hasCompleteCircuitSequence(circuit.holds.filter(hold => hold.circuitOrder !== 2)), true);
  assert.deepEqual(missingCircuitOrders([{ role: "hand", circuitOrder: 4 }]), [1, 2, 3]);
  assert.equal(hasCompleteCircuitSequence([{ role: "hand" }]), false);
  assert.equal(hasCompleteCircuitSequence([{ role: "hand", circuitOrder: 1 }, { role: "hand", circuitOrder: 1 }]), false);
});

test("stored circuits require unique valid numbers and older circuits with gaps remain readable", () => {
  assert.equal(isSavedClimb(circuit), true);
  assert.deepEqual(parseSavedClimbs(JSON.stringify([gappedCircuit])), [gappedCircuit]);
  assert.equal(isSavedClimb({ ...circuit, isCircuit: undefined, holds: setCircuitHolds(circuit.holds, false) }), true);
  for (const value of [0, -1, 1.5, 201, "1", null, undefined, 2]) {
    assert.equal(isSavedClimb({ ...circuit, holds: circuit.holds.map(hold => hold.holdId === "one" ? { ...hold, circuitOrder: value } : hold) }), false);
  }
  assert.equal(isSavedClimb({ ...circuit, isCircuit: "yes" }), false);
  assert.equal(isSavedClimb({ ...circuit, isCircuit: false }), false);
  for (const role of ["foot", "start", "finish"]) {
    assert.equal(isSavedClimb({ ...circuit, holds: circuit.holds.map(hold => hold.holdId === role ? { ...hold, circuitOrder: 2 } : hold) }), false);
  }
});

test("circuit labels anchor against the upper-right border of outlined and circular handholds", () => {
  const html = renderToStaticMarkup(createElement(CircuitHoldNumbers, { holds: circuit.holds, enabled: true }));
  assert.match(html, /aria-label="Circuit handhold 1"/);
  assert.match(html, /aria-label="Circuit handhold 2"/);
  assert.match(html, /left:calc\(38% \+ [0-9.]+px - var\(--circuit-corner-inset\)\)/);
  const circleOffset = `${circuit.holds[2].size * Math.SQRT1_2 / 2}cqw`;
  assert.ok(html.includes(`left:calc(60% + ${circleOffset} - var(--circuit-corner-inset))`));
  assert.ok(html.includes(`top:calc(45% - ${circleOffset} + var(--circuit-corner-inset))`));
  assert.equal((html.match(/class="circuit-hold-number"/g) ?? []).length, 2);
  assert.equal(renderToStaticMarkup(createElement(CircuitHoldNumbers, { holds: circuit.holds, enabled: false })), "");
});

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  t.after(() => sqlite.close());
  function prepare(sql, values = []) {
    return {
      bind(...parameters) { return prepare(sql, parameters); },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })) }; },
      async first() { const row = sqlite.prepare(sql).get(...values); return row ? { ...row } : null; },
      async run() { sqlite.prepare(sql).run(...values); return { success: true }; },
    };
  }
  const db = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  return { sqlite, request: (path, method = "GET", body) => handleAppDataRequest(new Request(`http://localhost${path}`, {
    method, headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), db) };
}

async function setup(t) {
  const { sqlite, request } = database(t);
  const profile = (await (await request("/api/profiles", "POST", { name: "Admin" })).json()).profile;
  const response = await request("/api/wall-holds", "PUT", { holds: spots, expectedUpdatedAt: 0, profileId: profile.id });
  assert.equal(response.status, 200);
  const expectedWallUpdatedAt = (await response.json()).updatedAt;
  const body = { climb: circuit, expectedWallUpdatedAt, profileId: profile.id };
  const changes = { name: circuit.name, grade: circuit.grade, holds: circuit.holds, isCircuit: true, expectedWallUpdatedAt, profileId: profile.id };
  return { sqlite, request, body, changes };
}

test("circuits and their numbering persist through creation, sends, listing, reloading, approval, and editing", async t => {
  const { sqlite, request, body, changes } = await setup(t);
  const response = await request("/api/climbs", "POST", { ...body, sendRating: 4 });
  assert.equal(response.status, 201);
  const created = (await response.json()).climb;
  assert.equal(created.isCircuit, true);
  assert.deepEqual(created.holds, circuit.holds);
  assert.equal(sqlite.prepare("SELECT is_circuit FROM climbs").get().is_circuit, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM climb_sends").get().count, 1);
  for (const path of ["/api/climbs", "/api/climbs/circuit-test"]) {
    const payload = await (await request(path)).json();
    const climb = payload.climb ?? payload.climbs[0];
    assert.equal(isSavedClimb(climb), true);
    assert.equal(climb.isCircuit, true);
    assert.deepEqual(climb.holds, created.holds);
  }
  const approved = await request("/api/climbs/circuit-test/rocko-approval", "PUT", { profileId: body.profileId, rockoApproved: true });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).climb.isCircuit, true);
  const editedHolds = circuit.holds.map(hold => hold.role === "hand" ? { ...hold, circuitOrder: hold.circuitOrder === 1 ? 2 : 1 } : hold);
  const updated = await request("/api/climbs/circuit-test", "PUT", { ...changes, holds: editedHolds });
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).climb.holds, editedHolds);
  const disabled = await request("/api/climbs/circuit-test", "PUT", { ...changes, isCircuit: false, holds: setCircuitHolds(editedHolds, false) });
  assert.equal(disabled.status, 200);
  const ordinary = (await disabled.json()).climb;
  assert.ok(!ordinary.isCircuit);
  assert.ok(ordinary.holds.every(hold => hold.circuitOrder === undefined));
  assert.equal(sqlite.prepare("SELECT is_circuit FROM climbs").get().is_circuit, 0);
});

test("invalid circuit numbers are rejected on creation and editing without changing the stored climb", async t => {
  const { request, body, changes } = await setup(t);
  assert.equal((await request("/api/climbs", "POST", body)).status, 201);
  for (const invalid of [
    { isCircuit: "yes", holds: circuit.holds },
    { isCircuit: false, holds: circuit.holds },
    { isCircuit: true, holds: gappedCircuit.holds },
    { isCircuit: true, holds: circuit.holds.filter(hold => hold.circuitOrder !== 1) },
    ...[undefined, 0, -1, 1.5, 201, "1", null, 2].map(order => ({ isCircuit: true,
      holds: circuit.holds.map(hold => hold.holdId === "one" ? { ...hold, circuitOrder: order } : hold),
    })),
    ...["start", "foot", "finish"].map(role => ({ isCircuit: true,
      holds: circuit.holds.map(hold => hold.role === role ? { ...hold, circuitOrder: 2 } : hold),
    })),
  ]) {
    assert.equal((await request("/api/climbs", "POST", { ...body, climb: { ...circuit, id: crypto.randomUUID(), ...invalid } })).status, 400);
    assert.equal((await request("/api/climbs/circuit-test", "PUT", { ...changes, ...invalid })).status, 400);
  }
  const loaded = (await (await request("/api/climbs/circuit-test")).json()).climb;
  assert.equal(loaded.isCircuit, true);
  assert.deepEqual(loaded.holds, circuit.holds);
});

test("older circuits with gaps can be viewed and edited, but must be completed before saving", async t => {
  const { sqlite, request, body, changes } = await setup(t);
  assert.equal((await request("/api/climbs", "POST", body)).status, 201);
  sqlite.prepare("UPDATE climbs SET holds_json = ? WHERE id = ?").run(JSON.stringify(gappedCircuit.holds), circuit.id);
  const response = await request("/api/climbs/circuit-test");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).climb.holds, gappedCircuit.holds);
  assert.equal((await request("/api/climbs/circuit-test", "PUT", { ...changes, holds: gappedCircuit.holds })).status, 400);
  assert.equal((await request("/api/climbs/circuit-test", "PUT", changes)).status, 200);
});

test("both the migration and runtime upgrade preserve existing ordinary climbs", async t => {
  for (const migrate of [false, true]) {
    const { sqlite, request } = database(t);
    sqlite.exec("CREATE TABLE climbs (id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT NOT NULL, setter TEXT NOT NULL, created_at INTEGER NOT NULL, holds_json TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', rocko_approved INTEGER NOT NULL DEFAULT 0)");
    const ordinary = { ...circuit, holds: setCircuitHolds(circuit.holds, false) };
    sqlite.prepare("INSERT INTO climbs (id, name, grade, setter, created_at, holds_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ordinary.id, ordinary.name, ordinary.grade, ordinary.setter, ordinary.createdAt, JSON.stringify(ordinary.holds));
    if (migrate) sqlite.exec(await readFile(new URL("../drizzle/0009_add_climb_circuits.sql", import.meta.url), "utf8"));
    const response = await request("/api/climbs/circuit-test");
    assert.equal(response.status, 200);
    const climb = (await response.json()).climb;
    assert.ok(!climb.isCircuit);
    assert.deepEqual(climb.holds, ordinary.holds);
    assert.equal(sqlite.prepare("SELECT is_circuit FROM climbs").get().is_circuit, 0);
  }
});

test("climb API requests carry the circuit flag and explicit numbers for creates and edits", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ climb: circuit });
  });
  await saveClimb(circuit, 123, "profile-test");
  await updateClimb(circuit, 123, "profile-test");
  assert.equal(requests[0].climb.isCircuit, true);
  assert.deepEqual(requests[0].climb.holds, circuit.holds);
  assert.equal(requests[1].isCircuit, true);
  assert.deepEqual(requests[1].holds, circuit.holds);
});

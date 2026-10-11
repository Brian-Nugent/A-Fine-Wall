import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import console from "node:console";
import { URL } from "node:url";

// One-time initialization after the explicitly requested October live-wall reset.
// Deployment never runs this script or copies data between live and test.
const base = "https://a-fine-wall.bnugent1021.workers.dev";
const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
assert.equal(config.name, "a-fine-wall");
const database = config.d1_databases.find(binding => binding.binding === "DB");
assert.equal(database.database_name, "a-fine-wall-db");
assert.equal(database.database_id, "461f66f8-4196-4501-ac76-8e9576d19248");
assert.equal(config.r2_buckets.find(binding => binding.binding === "WALL_PHOTOS").bucket_name,
  "a-fine-wall-wall-photos");
const layout = JSON.parse(await readFile(new URL("../data/wall-layouts/2026-10-live-wall.json", import.meta.url), "utf8"));
async function get(path) {
  const response = await globalThis.fetch(base + path, { cache: "no-store" });
  assert.equal(response.status, 200, path);
  return response;
}
const [wall, climbs, profiles, photo] = await Promise.all([
  get("/api/wall-holds").then(response => response.json()),
  get("/api/climbs").then(response => response.json()),
  get("/api/profiles").then(response => response.json()),
  get("/api/wall-photo").then(response => response.arrayBuffer()),
]);
assert.equal(wall.holds.length, 0, "Live wall already has holds; refusing to overwrite them.");
assert.equal(climbs.climbs.length, 0, "Live wall already has climbs; reset it explicitly first.");
assert.equal(createHash("sha256").update(Buffer.from(photo)).digest("hex"), layout.photoSha256,
  "The live photo has changed; these outlines would not align.");
const admin = profiles.profiles.find(profile => profile.name.toLowerCase() === "admin");
assert.ok(admin, "An existing Admin profile is required.");
const response = await globalThis.fetch(base + "/api/wall-holds", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ holds: layout.holds, expectedUpdatedAt: wall.updatedAt, profileId: admin.id }),
});
assert.equal(response.status, 200, `Live hold import failed: ${response.status}`);
assert.deepEqual((await response.json()).holds, layout.holds, "Saved map differs from the import.");
assert.deepEqual((await (await get("/api/wall-holds")).json()).holds, layout.holds, "Map did not reload correctly.");
assert.deepEqual(await (await get("/api/profiles")).json(), profiles, "Profiles changed during import.");
assert.equal((await (await get("/api/climbs")).json()).climbs.length, 0);
console.log(`Imported and verified ${layout.holds.length} freshly outlined holds at ${base}.`);

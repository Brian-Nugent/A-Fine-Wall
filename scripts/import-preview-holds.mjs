import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import console from "node:console";
import { URL } from "node:url";
import { getPreviewStorage } from "./preview-config.mjs";

// This one-time import targets only the isolated iPhone test app.
const base = "https://iphone-test-a-fine-wall.bnugent1021.workers.dev";
const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
const { database } = getPreviewStorage(config);
if (config.name !== "a-fine-wall" || database.database_name !== "a-fine-wall-test-db" ||
    database.database_id !== "8e6c04fc-d17b-4af2-a9cd-149fd663a8ea") {
  throw new Error("The test bindings do not match this wall import.");
}
const layout = JSON.parse(await readFile(new URL("../data/wall-layouts/2026-10-test-wall.json", import.meta.url), "utf8"));
async function get(path) {
  const response = await globalThis.fetch(base + path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response;
}
const [wall, profiles, photo] = await Promise.all([
  get("/api/wall-holds").then(response => response.json()),
  get("/api/profiles").then(response => response.json()),
  get("/api/wall-photo").then(response => response.arrayBuffer()),
]);
if (wall.holds.length > 0) throw new Error("The test wall already has holds. Refusing to overwrite them.");
if (createHash("sha256").update(Buffer.from(photo)).digest("hex") !== layout.photoSha256) {
  throw new Error("The test photo has changed; these outlines would not align.");
}
const admin = profiles.profiles.find(profile => profile.name.toLowerCase() === "admin");
if (!admin) throw new Error("Choose the Admin profile on the test app first.");
const response = await globalThis.fetch(base + "/api/wall-holds", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ holds: layout.holds, expectedUpdatedAt: wall.updatedAt, profileId: admin.id }),
});
if (!response.ok) throw new Error(`Test hold import failed: ${response.status} ${await response.text()}`);
const saved = await response.json();
if (JSON.stringify(saved.holds) !== JSON.stringify(layout.holds)) throw new Error("The saved hold map differs from the import.");
const reloaded = await (await get("/api/wall-holds")).json();
if (JSON.stringify(reloaded.holds) !== JSON.stringify(layout.holds)) throw new Error("The saved hold map did not reload correctly.");
console.log(`Imported and verified ${saved.holds.length} outlined holds at ${base}.`);

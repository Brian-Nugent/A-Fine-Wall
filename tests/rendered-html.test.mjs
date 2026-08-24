import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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
    assert.match(html, /wall-prototype\.png/);
    assert.match(html, /hold-marker--start/);
    assert.match(html, /hold-marker--hand/);
    assert.match(html, /hold-marker--finish/);
    assert.match(html, /Hold marker legend/);
    assert.match(html, /starts at the green hold marked S/);
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

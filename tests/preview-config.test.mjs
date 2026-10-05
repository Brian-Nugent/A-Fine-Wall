import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewStorage } from "../scripts/preview-config.mjs";

function config() {
  return {
    preview_urls: true,
    d1_databases: [{ database_id: "live-db-id", database_name: "live-db" }],
    r2_buckets: [{ bucket_name: "live-photos" }],
    previews: {
      d1_databases: [{
        binding: "DB", database_id: "test-db-id", database_name: "test-db",
      }],
      r2_buckets: [{ binding: "WALL_PHOTOS", bucket_name: "test-photos" }],
    },
  };
}

test("preview deployment accepts separate database and photo storage", () => {
  const source = config();
  assert.deepEqual(getPreviewStorage(source), {
    database: source.previews.d1_databases[0],
    photos: source.previews.r2_buckets[0],
  });
});

test("preview deployment refuses a configuration without reachable preview URLs", () => {
  const source = config();
  source.preview_urls = false;
  assert.throws(() => getPreviewStorage(source), /Enable preview_urls/);
});

test("preview deployment rejects either production storage binding", () => {
  for (const [field, value] of [
    ["database_id", "live-db-id"], ["database_name", "live-db"],
  ]) {
    const source = config();
    source.previews.d1_databases[0][field] = value;
    assert.throws(() => getPreviewStorage(source), /separate from production/);
  }
  const source = config();
  source.previews.r2_buckets[0].bucket_name = "live-photos";
  assert.throws(() => getPreviewStorage(source), /separate from production/);
});

test("preview deployment rejects missing bindings instead of falling back", () => {
  for (const key of ["d1_databases", "r2_buckets"]) {
    const source = config();
    delete source.previews[key];
    assert.throws(() => getPreviewStorage(source), /both be configured/);
    const missingProduction = config();
    delete missingProduction[key];
    assert.throws(() => getPreviewStorage(missingProduction), /verify Preview isolation/);
  }
});

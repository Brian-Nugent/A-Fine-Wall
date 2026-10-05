/** Refuse to migrate or publish a Preview backed by production storage. */
export function getPreviewStorage(config) {
  if (config.preview_urls !== true) {
    throw new Error("Enable preview_urls before publishing the iPhone test link.");
  }
  const database = config.previews?.d1_databases?.find(
    (binding) => binding.binding === "DB",
  );
  const photos = config.previews?.r2_buckets?.find(
    (binding) => binding.binding === "WALL_PHOTOS",
  );

  if (!database?.database_id || !database.database_name || !photos?.bucket_name) {
    throw new Error("Preview DB and WALL_PHOTOS bindings must both be configured.");
  }
  if (!config.d1_databases?.length || !config.r2_buckets?.length) {
    throw new Error("Production bindings are required to verify Preview isolation.");
  }
  if (
    config.d1_databases.some(
      (binding) => binding.database_id === database.database_id ||
        binding.database_name === database.database_name,
    ) ||
    config.r2_buckets.some(
      (binding) => binding.bucket_name === photos.bucket_name,
    )
  ) {
    throw new Error("Preview storage must be separate from production storage.");
  }

  return { database, photos };
}

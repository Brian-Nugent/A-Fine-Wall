import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { getPreviewStorage } from "./preview-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const buildConfigPath = resolve(root, "dist/server/wrangler.json");
const buildConfig = JSON.parse(await readFile(buildConfigPath, "utf8"));
const { database } = getPreviewStorage(buildConfig);
const migrationConfigPath = resolve(root, ".wrangler/preview-migrations.json");

// D1's migration command does not select the `previews` block. Give it a
// dedicated config containing only the already-validated test database.
await mkdir(dirname(migrationConfigPath), { recursive: true });
await writeFile(migrationConfigPath, JSON.stringify({
  account_id: buildConfig.account_id,
  d1_databases: [{ ...database, migrations_dir: resolve(root, "drizzle") }],
}, null, 2) + "\n");

function wrangler(args) {
  execFileSync(process.execPath, [
    resolve(root, "node_modules/wrangler/bin/wrangler.js"),
    ...args,
  ], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve(root, ".wrangler/wrangler.log"),
    },
  });
}

wrangler([
  "d1", "migrations", "apply", database.database_name,
  "--remote", "--config", migrationConfigPath,
]);
wrangler([
  "preview", "--config", buildConfigPath,
  "--name", "iphone-test", "--ignore-base-config",
]);

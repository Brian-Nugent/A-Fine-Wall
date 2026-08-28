# A Fine Wall

A Fine Wall is a mobile-first web app for setting, browsing, and logging
bouldering climbs on a shared wall. Climbers can inspect each problem on the
wall photo, filter the climb list, log a grade and star rating, and review the
community logbook. Admin-only tools manage the wall photo, preset hold spots,
and Rocko Approved climbs.

The production app runs at
[a-fine-wall.bnugent1021.workers.dev](https://a-fine-wall.bnugent1021.workers.dev).

## Features

- Set and edit climbs against preset spots on the wall photo.
- Browse and filter by grade, sends, community rating, order, holds, setter,
  and Rocko approval.
- Log a send with a proposed grade and one-to-five-star rating.
- Calculate consensus grades and community ratings from send entries.
- Show a per-climb logbook with each climber's grade and stars.
- Let Admin update the wall setup and give or remove Rocko's Approval.
- Install the site as a progressive web app on a home screen.
- Retain device-local climb copies as a fallback and synchronize them with
  shared storage.

## Stack

| Layer | Technology |
| --- | --- |
| UI | React 19 and TypeScript |
| App framework | Vinext with Next App Router-compatible APIs |
| Build | Vite |
| Runtime and hosting | Cloudflare Workers |
| Structured data | Cloudflare D1 (SQLite) |
| Wall photo storage | Cloudflare R2 |
| Schema and migrations | Drizzle ORM and Drizzle Kit |
| Styling | Tailwind CSS pipeline with custom global CSS |
| Testing | Node's built-in test runner with in-memory Cloudflare bindings |

Vinext provides the App Router surface used by files under `app/`, while Vite
and the Cloudflare plugin build the application for the Workers runtime. This
is not a stock Next.js build.

## Architecture

```text
Browser or installed PWA
            |
            v
Cloudflare Worker (worker/index.ts)
  |-- page request ------> Vinext App Router ------> React server/client UI
  |-- /api/... ----------> worker/app-data.ts -----> D1
  |-- /api/wall-photo ---> worker/wall-photo.ts ---> R2
  `-- static asset ------> Cloudflare ASSETS binding
```

The Worker handles application APIs before handing page requests to Vinext.
Production APIs are implemented directly in `worker/app-data.ts`, rather than
as `app/api` route handlers:

- `/api/profiles` stores the app's user profiles.
- `/api/climbs` creates, reads, updates, and deletes climbs.
- `/api/sends` stores send grades and star ratings and returns logbook data.
- `/api/wall-holds` stores the preset wall spots and their revision.
- `/api/wall-photo` reads and updates the R2 wall image.

Most runtime D1 access uses prepared SQL through `D1Database`. Drizzle defines
the schema and generates migrations, but the production API does not generally
use the Drizzle query builder.

## Local Development

### Prerequisites

- Node.js `>=22.13.0`
- npm

Remote migrations and deployment also require Wrangler authentication with
access to the Cloudflare account and resources configured in `wrangler.jsonc`.

### Start the app

```bash
git clone https://github.com/Brian-Nugent/A-Fine-Wall.git
cd A-Fine-Wall
npm ci
npm run dev
```

Open the local URL printed by Vinext. On first use, the app asks for a profile
name before showing the climb list.

The Cloudflare Vite plugin supplies local versions of the bindings declared in
`wrangler.jsonc`; local development does not connect to production D1 or R2.
Local Wrangler and Miniflare state is kept in the ignored `.wrangler/`
directory. A fresh D1 schema is initialized on the first app-data request. If
no wall photo has been uploaded locally, the app falls back to
`public/wall-prototype.png`.

The fresh local database contains no climbs, and the bundled demo list is
empty. To populate it through the UI, create the `Admin` profile, configure the
wall photo and hold spots, and then set a climb. No seed command is currently
provided.

Use `npm install` instead of `npm ci` only when intentionally changing
dependencies and updating `package-lock.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vinext development server. |
| `npm run build` | Create a production build in `dist/`. |
| `npm start` | Serve the built app locally. |
| `npm run lint` | Run ESLint with TypeScript, React, hooks, accessibility, and Next rules. |
| `npm test` | Build the app, then run the full Node test suite. |
| `npm run db:generate` | Generate migration SQL and metadata from `db/schema.ts`. |
| `npm run db:migrate:remote` | Apply pending migrations to the configured production D1 database. |
| `npm run deploy:cloudflare:built` | Migrate D1 and deploy an existing build. |
| `npm run deploy:cloudflare` | Build, migrate D1, and deploy the Worker. |

`npm run db:migrate:remote` changes the production database; it is not part of
local setup. Use `npm run deploy:cloudflare:built` only when `dist/` was freshly
built from the same commit.

## Data and Storage

The D1 schema is defined in `db/schema.ts` and currently contains:

- `profiles`: canonical app profiles.
- `wall_configuration`: the wall's preset hold spots and revision.
- `climbs`: climb metadata, setter grade, hold data, and Rocko approval.
- `deleted_climbs`: tombstones that keep stale device copies from restoring a
  deleted climb.
- `climb_sends`: one send per climb and profile, including the proposed grade,
  star rating, and timestamps.

Climb holds and the wall configuration are stored as validated JSON within D1.
The grade in `climbs` remains the setter's original grade; API reads calculate
the displayed consensus grade from logged send grades. The wall photograph is
stored separately in the `WALL_PHOTOS` R2 bucket under `wall/current`.

The browser also uses:

- `localStorage` for the active profile and device-local climb copies.
- A `SameSite=Lax` profile cookie to seed server-rendered pages.
- `sessionStorage` for the filtered climb order used by swipe navigation.

`app/climbs/synced-climbs.ts` uploads device-local climbs when possible, merges
them with shared D1 records, and retains local records if shared storage is
temporarily unavailable. Browser data is a fallback, not the durable shared
database.

## Profiles and Authorization

The current app uses password-free, app-local profiles. A visitor chooses a
name, the API creates or returns the canonical case-insensitive profile, and
the browser remembers its ID. This is an identity-selection model, not strong
credential authentication.

Admin status is based on the canonical profile name `Admin`. The Worker
enforces setter and Admin checks against D1, but there is no signed session
proving ownership of a profile ID. Do not treat a profile ID, the profile
cookie, or the Admin name as secure identity for a public or multi-tenant
deployment. The current model is best suited to a trusted group or a deployment
protected by an external access policy.

`app/chatgpt-auth.ts` contains optional Sign in with ChatGPT helpers retained
from the hosting starter, but current application pages do not use them for
profile selection or authorization.

## Database Changes

When changing the schema:

1. Update `db/schema.ts`.
2. Generate a migration with `npm run db:generate`.
3. Review and commit the new SQL and metadata under `drizzle/` together with
   the schema change.
4. Run `npm run lint` and `npm test`.
5. Deploy with `npm run deploy:cloudflare`.

The deployment script applies remote D1 migrations before deploying the
Worker. If Worker deployment fails, the database remains migrated, so
migrations should remain compatible with the currently deployed Worker.
`worker/app-data.ts` also performs defensive schema checks for old or empty
installations, but those checks do not replace committed migrations.

## Testing

`npm test` first builds the production Worker and then runs
`tests/rendered-html.test.mjs` with Node's built-in test runner. The suite
exercises rendered routes, API behavior, migrations, filtering, sync logic,
authorization, and PWA configuration with in-memory D1 and R2 substitutes.

The suite is not a real-browser test. Visual behavior, touch interactions, and
installed-PWA behavior should also be checked manually in the target browser.

## Progressive Web App

`public/manifest.webmanifest` defines the standalone app, start URL, theme, and
home-screen icons. `app/pwa-registration.tsx` registers `public/sw.js` in
production on secure origins.

The service worker is deliberately network-first. It caches only
`public/offline.html` for failed navigations and does not cache API responses or
the complete app data set. The app is installable and has an offline fallback,
but it is not designed for complete offline operation.

Because service-worker registration is disabled in development, use a
production build or the deployed HTTPS app when testing installation and
offline behavior.

## Deployment

Cloudflare resource bindings and the Worker entry point are declared in
`wrangler.jsonc`:

- `ASSETS` serves the static build.
- `DB` connects to the D1 database.
- `WALL_PHOTOS` connects to the R2 bucket.

The committed Wrangler configuration is tied to the existing Cloudflare
account, D1 database, and R2 bucket. A fork or separate environment must replace
those identifiers instead of deploying the configuration unchanged.

The canonical production origin also appears in `app/layout.tsx` and the
legacy-host redirect in `worker/index.ts`; update both when moving the app to a
different domain.

With Wrangler authenticated for the configured Cloudflare account, deploy the
current source with:

```bash
npm run deploy:cloudflare
```

The command builds the app, applies remote D1 migrations, and then deploys the
generated Worker. The repository also retains `.openai/hosting.json` as an
OpenAI Sites migration fallback. The custom build plugin copies that metadata
and the Drizzle migrations into `dist/.openai`, but it is not the Cloudflare
Worker deployment configuration.

## Repository Map

| Path | Contents |
| --- | --- |
| `app/` | App Router pages, client components, UI logic, and global styles. |
| `worker/` | Cloudflare Worker entry point and production API handlers. |
| `db/` | Drizzle schema and D1 binding helpers. |
| `drizzle/` | Ordered SQL migrations and migration metadata. |
| `public/` | PWA assets, icons, service worker, and offline fallback. |
| `tests/` | Build-backed integration and utility tests. |
| `build/` | Custom Vite build integration for hosting metadata. |

## References

- [Vinext](https://github.com/cloudflare/vinext)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Drizzle ORM for D1](https://orm.drizzle.team/docs/get-started/d1-new)

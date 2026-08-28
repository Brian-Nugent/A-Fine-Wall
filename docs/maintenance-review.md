# Maintenance Review

Reviewed on 2026-08-28 on the `optimize` branch.

## Scope

The review covered the React/Vinext application, Cloudflare Worker handlers,
D1 schema and migrations, R2 wall-photo handling, browser persistence and
sync, PWA assets, build tooling, dependencies, linting, and tests. Changes in
this pass are intentionally limited to behavior-preserving maintenance and
reliability work.

## Improvements Included

- Updated the compatible React, Vinext, Vite, and Cloudflare build/runtime
  cohort to patched versions.
- Added generated Cloudflare runtime and binding types, strict type checking,
  migration validation, and a single `npm run check` gate.
- Added CI and monthly dependency maintenance configuration.
- Added runtime validation for climb API responses and regression tests for
  browser-to-D1 climb migration.
- Avoided repeat migration writes for climbs that are already in D1.
- Cached defensive D1 schema initialization once per database binding and
  retained retry behavior after an initialization failure.
- Added server-side logging for unexpected API and wall-photo failures without
  exposing additional details to clients.
- Removed unused starter code, examples, styles, and static assets.

## Follow-up Work That Needs Product Decisions

These items were not changed because they would alter user-visible behavior,
deployment architecture, or stored data.

1. **Real authentication.** Profiles are selectors, not credentials, and the
   canonical `Admin` name is the authorization role. A public deployment
   should use signed sessions or an external access layer before treating
   profile IDs as identity.
2. **Atomic wall revisions.** The R2 wall image and D1 hold map are updated in
   separate requests. Versioned/staged wall configurations would prevent a
   partial setup if one write succeeds and the other fails.
3. **Browser and installed-PWA coverage.** The automated suite validates the
   production Worker and application behavior but does not render in Safari or
   an installed iOS PWA. Add a small WebKit/mobile browser suite before making
   visual or gesture changes.
4. **Wall-image normalization.** Uploads are byte-limited but are served at
   their original dimensions. Downsampling, orientation normalization, and
   versioned cacheable URLs would reduce mobile memory and bandwidth use, but
   require an image-processing and migration decision.
5. **Visible route-error states.** A transient failure while directly opening
   a saved climb can leave too little visible recovery UI. Adding explicit
   retry/not-found states is recommended, but would intentionally change the
   interface.

## Dependency Audit Note

There are no high- or critical-severity advisories after this pass. npm still
reports a moderate advisory in an old `esbuild` nested inside Drizzle Kit's
command-line loader. The affected copy is not the Vite development server or
the deployed Worker. npm's proposed automated fix downgrades Drizzle Kit to an
incompatible version, so it was not forced; keep Drizzle Kit current and
remove this note when its dependency chain is repaired upstream.

import { registerHooks } from "node:module";

// The built worker imports `cloudflare:workers`, which only exists in workerd.
// Tests load that build in plain Node, so provide an empty stand-in: vinext
// treats its optional exports as absent, and server code that needs a real
// binding (db/index.ts) throws and takes its existing client-side fallback.
const SPECIFIER = "cloudflare:workers";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === SPECIFIER
      ? { url: SPECIFIER, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url === SPECIFIER
      ? { format: "module", source: "export const env = {};", shortCircuit: true }
      : nextLoad(url, context);
  },
});

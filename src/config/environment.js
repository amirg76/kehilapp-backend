/**
 * What NODE_ENV actually means here, in one place.
 *
 * WHY THIS FILE EXISTS. Four separate places asked `process.env.NODE_ENV ===
 * 'production'` — but this project's own production script is
 * `"prod": "cross-env NODE_ENV=prod nodemon src/index.js"` (package.json). It
 * sets `prod`, so every one of those comparisons was false in exactly the
 * situation it was written for: the session cookie shipped without `secure`,
 * localhost stayed on the CORS allowlist next to `Allow-Credentials: true`, and
 * two destructive scripts happily agreed to run. The bug was not any one of
 * those lines; it was that the question was answered four times, by hand.
 *
 * So the question is answered once, here, and the string literal appears nowhere
 * else.
 */

/** Lower-cased, trimmed NODE_ENV — '' when it is unset. */
const current = () => (process.env.NODE_ENV || '').trim().toLowerCase();

/** Everything this project calls production. `npm run prod` sets the second one. */
const PRODUCTION_NAMES = ['production', 'prod'];

/**
 * Names that are demonstrably NOT production: the ones package.json's own
 * scripts set, plus the one jest sets. Anything outside both lists — 'staging',
 * 'prod-eu', a typo, or nothing at all — is UNRECOGNISED, and the two lists are
 * deliberately not exhaustive of each other so it stays that way.
 */
const NON_PRODUCTION_NAMES = ['local', 'dev', 'development', 'test'];

/** True when NODE_ENV names production, under either spelling. */
export const isProduction = () => PRODUCTION_NAMES.includes(current());

/**
 * True only when NODE_ENV names a known non-production environment.
 *
 * This is NOT `!isProduction()`. An unrecognised or missing value answers false
 * to both — which is the point. A caller that is about to do something
 * irreversible asks this one and refuses on false, so an environment nobody
 * anticipated is treated as dangerous rather than as development.
 */
export const isKnownNonProduction = () => NON_PRODUCTION_NAMES.includes(current());

/** The raw value, for an error message that has to tell the operator what it saw. */
export const nodeEnvName = () => current() || '(unset)';

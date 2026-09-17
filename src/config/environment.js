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
 * So the question is answered once, here. Other files still compare NODE_ENV for
 * NON-security reasons (app.js silences the request log under 'test',
 * services/logger.js picks a log format) — those are not this file's business.
 * What must not reappear anywhere else is a hand-rolled test for PRODUCTION.
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

/** Every value this project recognises, for an error message and for tests. */
export const ACCEPTED_NODE_ENV_VALUES = [...NON_PRODUCTION_NAMES, ...PRODUCTION_NAMES];

/**
 * Refuses to let the process continue when NODE_ENV names nothing this project
 * recognises. Throws — the caller decides how to die.
 *
 * WHY A HARD STOP AND NOT A DEFAULT. Every security decision downstream is a
 * two-way branch on "is this production", and an unrecognised value answers NO to
 * both directions. Whichever way such a value is resolved by default, it is
 * resolved silently and it is wrong half the time. package.json's `start` script
 * — `node src/index.js`, the command a hosting platform runs — sets no NODE_ENV
 * at all, and no Dockerfile, Procfile or deploy workflow in this repository pins
 * one either. So the ambiguous state was not hypothetical: it was the DEFAULT
 * state of a real deployment, and it shipped the session cookie without `secure`
 * and left localhost on the CORS allowlist next to Allow-Credentials: true.
 *
 * Removing the ambiguous state is what makes every guard downstream trustworthy.
 * A server that refuses to boot is a five-minute configuration fix; a server that
 * boots into the wrong half of every security branch is a silent one.
 */
export const assertKnownEnvironment = () => {
  if (isProduction() || isKnownNonProduction()) return;
  throw new Error(
    `NODE_ENV=${nodeEnvName()} is not an environment this server recognises, and it refuses to guess. ` +
      `Every security decision below this line — the session cookie's \`secure\` flag, the CORS allowlist — ` +
      `branches on whether this is production, and an unrecognised value answers that question neither way. ` +
      `Set NODE_ENV to one of: ${ACCEPTED_NODE_ENV_VALUES.join(', ')}.`,
  );
};

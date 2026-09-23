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

/** The opt-in that lets a verification token travel in an API response body. */
const VERIFICATION_LINK_EXPOSURE_FLAG = 'EXPOSE_VERIFICATION_LINK';

/**
 * May this server put a raw verification token in an API response body?
 *
 * WHAT THIS REPLACES, AND WHY. The answer used to be "whenever no real mail was
 * delivered" — and since the default transport delivers nothing, that resolved to
 * "always". Registering with someone else's address therefore handed the caller
 * the token that verifies that address. The condition was never a decision
 * anybody made; it was a development convenience that nothing turned off.
 *
 * So it is now TWO explicit conditions, and both must hold:
 *  - `isKnownNonProduction()`, not `!isProduction()` — an unrecognised or missing
 *    NODE_ENV answers false, so the unconfigured deployment fails CLOSED. (That
 *    state cannot reach here anyway while assertKnownEnvironment() runs at boot,
 *    but this must not depend on another guard staying in place.)
 *  - the operator set the flag, by name, to the literal string 'true'.
 *
 * The link is written to the server log on every path regardless, so a developer
 * who sets neither can still copy it out of the terminal. Nothing about this gate
 * blocks local work; it only decides what crosses the network to a stranger.
 */
export const mayExposeVerificationLink = () =>
  isKnownNonProduction() && process.env[VERIFICATION_LINK_EXPOSURE_FLAG] === 'true';

/**
 * Refuses to boot when the exposure flag is set in an environment that is not a
 * known non-production one. Throws — the caller decides how to die.
 *
 * WHY A HARD STOP RATHER THAN JUST IGNORING THE FLAG. mayExposeVerificationLink()
 * already fails closed, so a production server with the flag set is safe — and
 * silently not doing what its own configuration says. The realistic path back to
 * the original hole is an operator who finds that demo registration "does not
 * work", sets this flag, sees no change, and keeps escalating until something
 * gives. Refusing to boot answers that operator in one line instead of letting
 * them hunt.
 */
export const assertVerificationLinkExposureIsSafe = () => {
  if (process.env[VERIFICATION_LINK_EXPOSURE_FLAG] !== 'true') return;
  if (isKnownNonProduction()) return;
  throw new Error(
    `${VERIFICATION_LINK_EXPOSURE_FLAG}=true is a development-only convenience and NODE_ENV=${nodeEnvName()} is not a ` +
      `development environment. It makes POST /api/auth/register and /api/auth/resend-verification return the raw ` +
      `email-verification token in the response body, so anyone who registers with someone else's address receives ` +
      `the token that verifies it. Unset it, and configure EMAIL_PROVIDER so the link is emailed instead.`,
  );
};

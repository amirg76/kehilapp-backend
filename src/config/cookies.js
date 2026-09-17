/**
 * Cookie options for the auth + CSRF cookies, in one place.
 *
 * Auth model: the JWT rides in an httpOnly cookie the browser stores and sends
 * automatically. JavaScript cannot read it, so an XSS can no longer lift the
 * token out of localStorage.
 *
 * Because a cookie is sent automatically, it needs CSRF defence. Two layers:
 *  1. SameSite — 'lax' (or 'strict') means the browser withholds the cookie on
 *     cross-site requests, which covers app.example.com <-> api.example.com
 *     (same site) and blocks a foreign site from riding the session.
 *  2. A double-submit CSRF token (see middlewares/csrf.js) for defence in depth
 *     and for the truly cross-site deployment where SameSite must be 'none'.
 *
 * Secure + SameSite come from the environment so local http dev works while
 * production stays locked down:
 *   COOKIE_SAMESITE = strict | lax | none   (default: lax)
 *   COOKIE_SECURE   = true | false          (default: on unless this is a KNOWN
 *                                            development environment)
 * SameSite=none is only valid together with Secure, so it forces Secure on.
 *
 * "In production" is config/environment.js's answer, not a string comparison
 * here. This line used to read `NODE_ENV === 'production'`, which is false under
 * `npm run prod` — so the one command that deploys this shipped the session
 * cookie WITHOUT Secure, over a deployment that is meant to be HTTPS.
 *
 * AND THE DEFAULT IS FAIL-CLOSED, not `isProduction()`. src/index.js refuses to
 * boot on an unrecognised NODE_ENV, so a running SERVER always has a known
 * answer — but this module is also imported directly, by the test suite and by
 * anything else that wants a cookie option object, and those paths never pass
 * that check. `isProduction()` is default-PERMIT: it answers false for 'staging',
 * for a typo and for nothing at all, and the false branch here drops `secure`.
 * `isKnownNonProduction()` is default-DENY: only the four names this project
 * actually uses for development turn the flag off. Same reasoning as the two
 * destructive scripts — the SAFE list is the one allowed to decide.
 */
import { isKnownNonProduction } from './environment.js';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

const SAMESITE_VALUES = ['strict', 'lax', 'none'];

/**
 * COOKIE_SAMESITE, trimmed before it is compared.
 *
 * The trim is load-bearing. A trailing space in a .env file — invisible in an
 * editor, and something dotenv preserves — used to reach the `cookie` package as
 * the sameSite value 'lax ', which it does not recognise; the result was a thrown
 * TypeError inside res.cookie(), i.e. a 500 on every login and every logout.
 */
const sameSite = () => {
  const raw = (process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  if (!raw) return 'lax';
  if (!SAMESITE_VALUES.includes(raw)) {
    throw new Error(
      `COOKIE_SAMESITE=${JSON.stringify(process.env.COOKIE_SAMESITE)} is not a valid SameSite value. ` +
        `Use one of: ${SAMESITE_VALUES.join(', ')}.`,
    );
  }
  return raw;
};

const TRUE_WORDS = ['true', '1', 'yes', 'y', 'on'];
const FALSE_WORDS = ['false', '0', 'no', 'n', 'off'];

/**
 * COOKIE_SECURE as a boolean, or null when it is not set at all.
 *
 * This used to be `process.env.COOKIE_SECURE === 'true'`, which accepted exactly
 * one spelling and treated EVERY other one as false. An operator writing
 * COOKIE_SECURE=1, TRUE or yes — plainly reaching for "turn it on" — turned the
 * flag OFF in production, and nothing said a word. A security flag must never be
 * disabled by a value that was trying to enable it, so an unrecognised value is
 * an error rather than a silent `false`.
 */
const secureOverride = () => {
  const raw = (process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (!raw) return null;
  if (TRUE_WORDS.includes(raw)) return true;
  if (FALSE_WORDS.includes(raw)) return false;
  throw new Error(
    `COOKIE_SECURE=${JSON.stringify(process.env.COOKIE_SECURE)} is not a recognised boolean. ` +
      `Use one of: ${[...TRUE_WORDS, ...FALSE_WORDS].join(', ')}. ` +
      `It is refused rather than read as "false", because disabling the session cookie's Secure flag ` +
      `must never be something a typo can do quietly.`,
  );
};

const secure = () => {
  if (sameSite() === 'none') return true; // browsers reject SameSite=None without Secure
  const override = secureOverride();
  if (override !== null) return override;
  // Default-DENY: off only where development is proven, never merely assumed.
  return !isKnownNonProduction();
};

/**
 * Validates the cookie environment once, at startup, so a bad COOKIE_SECURE or
 * COOKIE_SAMESITE is a refusal to boot rather than a 500 on the first login.
 * Throws; src/index.js turns that into an exit.
 */
export const assertCookieConfig = () => {
  sameSite();
  secureOverride();
};

export const AUTH_COOKIE = 'token';
export const CSRF_COOKIE = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';
export const COOKIE_MAX_AGE = TWELVE_HOURS;

/** The httpOnly session cookie — never readable from JS. */
export const authCookieOptions = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: sameSite(),
  maxAge: COOKIE_MAX_AGE,
  path: '/',
});

/** The CSRF cookie — deliberately readable by JS so the SPA can echo it back. */
export const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: secure(),
  sameSite: sameSite(),
  maxAge: COOKIE_MAX_AGE,
  path: '/',
});
